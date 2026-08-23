import React, { useCallback, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError } from "../src/api/client";
import { adminApi, PendingOtp } from "../src/api/admin";
import { Muted, Notice } from "../src/components/ui";
import {
  Avatar,
  EmptyState,
  IconButton,
  Loading,
  ScreenHeader,
  StatStrip,
} from "../src/components/adminui";
import { colors, radius, spacing, type } from "../src/theme";
import { formatTime } from "../src/lib/punch";

/** The web dashboard polls at this rate; matching it keeps the two consistent. */
const POLL_MS = 10000;

/**
 * Pending login codes.
 *
 * There is no SMS gateway behind the login flow — an employee asks for a code
 * and an admin reads it back to them, so this screen is a live board rather
 * than a list you act on. Hence no search, no filter chips and no row sheet: a
 * handful of five-minute codes never grows to the point where those help, and
 * every control added here is one more thing between an admin on the phone and
 * the six digits they need to say out loud.
 *
 * GET /api/admin/otp-requests expires stale rows as a side effect, so the poll
 * is tied to focus. Left running in the background it would keep writing to the
 * database from a screen nobody is looking at.
 */
export default function AdminCodesScreen() {
  const router = useRouter();

  const [codes, setCodes] = useState<PendingOtp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Drives every countdown on screen. One ticker for the list, not one per card.
  const [now, setNow] = useState(() => Date.now());

  // Poll and pull-to-refresh can both be in flight at once, and a slow first
  // response landing after a fast second one would put an older board back on
  // screen. Only the newest request is allowed to write.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const res = await adminApi.otpRequests();
      if (id !== seq.current) return;
      setCodes(Array.isArray(res.otpRequests) ? res.otpRequests : []);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load the pending login codes.");
    } finally {
      // Runs on the early returns too, so the spinner always lets go.
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      load();
      const poll = setInterval(load, POLL_MS);
      const tick = setInterval(() => setNow(Date.now()), 1000);
      return () => {
        clearInterval(poll);
        clearInterval(tick);
      };
    }, [load]),
  );

  function refresh() {
    setRefreshing(true);
    load();
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace("/(admin)");
  }

  // Soonest expiry first, with anything already dead sunk to the bottom, so a
  // code that just arrived is never pushed off screen by one nobody can use.
  const ordered = useMemo(() => {
    const list = codes ?? [];
    return [...list].sort((a, b) => {
      const ea = serverTime(a.expiresAt);
      const eb = serverTime(b.expiresAt);
      // NaN falls through to dead, matching what the card itself decides.
      const deadA = ea - now > 0 ? 0 : 1;
      const deadB = eb - now > 0 ? 0 : 1;
      if (deadA !== deadB) return deadA - deadB;
      // Never subtract here: two unreadable timestamps would hand sort() a NaN.
      const da = isNaN(ea) ? Infinity : ea;
      const db = isNaN(eb) ? Infinity : eb;
      return da === db ? 0 : da < db ? -1 : 1;
    });
  }, [codes, now]);

  const live = ordered.filter((c) => serverTime(c.expiresAt) - now > 0).length;
  const expired = ordered.length - live;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <View style={styles.headerFill}>
          <ScreenHeader
            onBack={back}
            title="Login codes"
            subtitle={codes ? `${live} waiting` : error ? "Couldn't load" : "Loading…"}
            right={
              <IconButton
                name="refresh"
                onPress={refresh}
                accessibilityLabel="Refresh login codes"
              />
            }
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />
        }
      >
        <View style={styles.blurb}>
          <Muted>
            There is no SMS gateway — codes are never texted. When someone asks to sign in their
            code appears here, and you read it out to them. It stops working the moment the
            countdown reaches zero.
          </Muted>
        </View>

        {error ? <Notice>{error}</Notice> : null}

        {ordered.length ? (
          <StatStrip
            stats={[
              { label: "Waiting", value: live, tone: live ? colors.brand : undefined },
              { label: "Expired", value: expired },
            ]}
          />
        ) : null}

        {loading && !codes ? <Loading /> : null}

        {ordered.map((code) => (
          <CodeCard key={code.id} code={code} now={now} />
        ))}

        {/* Only after a load that actually landed — otherwise a dead network
            would tell an admin nobody is waiting while someone is. */}
        {!loading && codes && !ordered.length ? (
          <EmptyState
            icon="key-outline"
            title="No one is waiting for a code"
            body="Codes appear here the moment an employee asks to sign in."
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One code. Quiet on the left, loud on the right — the digits are the only
 * thing the admin is actually here to read.
 */
function CodeCard({ code, now }: { code: PendingOtp; now: number }) {
  const left = serverTime(code.expiresAt) - now;
  const dead = !(left > 0);
  const tone = dead ? colors.muted : left > 60000 ? colors.ok : colors.warn;

  return (
    <View style={[styles.card, dead ? styles.cardDead : null]}>
      <Avatar name={code.employeeName} size={44} />

      <View style={styles.who}>
        <Text style={[styles.name, dead ? styles.nameDead : null]} numberOfLines={1}>
          {code.employeeName}
        </Text>
        <Text style={styles.employeeId} numberOfLines={1}>
          {code.employeeId}
        </Text>
        <Text style={styles.asked} numberOfLines={1}>
          {`Asked at ${formatTime(code.createdAt)}`}
        </Text>
      </View>

      <View style={styles.codeSide}>
        {/* No clipboard module ships with this app, so the code is selectable
            instead — a long press hands it to the OS text menu. */}
        <View style={[styles.codeBox, dead ? styles.codeBoxDead : null]}>
          <Text
            selectable
            style={[styles.code, dead ? styles.codeDead : null]}
            accessibilityLabel={code.otpCode.split("").join(" ")}
          >
            {code.otpCode}
          </Text>
        </View>
        <Text style={[styles.countdown, { color: tone }]}>
          {dead ? "Expired" : `${countdown(left)} left`}
        </Text>
      </View>
    </View>
  );
}

/**
 * "2026-08-22 03:41:20" -> epoch ms.
 *
 * Same shape as every other timestamp this API returns: written in UTC with no
 * zone marker, so the Z has to be put back before parsing or a fresh code would
 * read as 5.5 hours from expiry the instant it was issued. Mirrors formatTime
 * in src/lib/punch.ts, with a fallback for the day the server starts sending a
 * real offset instead.
 */
function serverTime(raw: string | null | undefined): number {
  if (!raw) return NaN;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const ms = new Date(iso.endsWith("Z") ? iso : `${iso}Z`).getTime();
  return isNaN(ms) ? Date.parse(raw) : ms;
}

/** 247000 -> "4:07" */
function countdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  headerRow: { flexDirection: "row", alignItems: "center", paddingLeft: spacing.lg },
  headerFill: { flex: 1 },

  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  blurb: { paddingBottom: spacing.xs },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardDead: { backgroundColor: colors.bg, borderColor: colors.rule },

  who: { flex: 1, gap: 2 },
  name: { ...type.heading, color: colors.ink },
  nameDead: { color: colors.inkSoft },
  employeeId: { ...type.small, color: colors.inkSoft },
  asked: { ...type.small, color: colors.muted, fontSize: 12 },

  codeSide: { alignItems: "flex-end", gap: spacing.xs },
  codeBox: {
    backgroundColor: colors.brandTint,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  codeBoxDead: { backgroundColor: colors.card, borderColor: colors.rule },
  code: {
    ...type.title,
    fontSize: 22,
    fontWeight: "800",
    color: colors.brand,
    letterSpacing: 4,
    // Tracking trails the last digit; this puts the run back on centre.
    paddingLeft: 4,
  },
  codeDead: { color: colors.muted },
  countdown: { ...type.small, fontSize: 12, fontWeight: "700" },
});
