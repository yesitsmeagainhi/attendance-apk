import React, { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, ApiError, PunchStatus } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Muted, Notice } from "../../src/components/ui";
import {
  EmptyState,
  Loading,
  Row,
  ScreenHeader,
  SectionHeader,
  StatusPill,
} from "../../src/components/adminui";
import { BirthdayBanner } from "../../src/components/BirthdayBanner";
import { NotificationBell } from "../../src/components/NotificationBell";
import { colors, radius, spacing, type } from "../../src/theme";
import { formatTime } from "../../src/lib/punch";

/** Same three buckets as the admin home, so both roles are greeted alike. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The employee home — the screen 68 people punch from every morning.
 *
 * One question gets answered above the fold: where do I stand today, and what
 * is the one thing I can do about it. So the two times live in a single hero
 * card, the punch button is the only primary action on the screen, and the log
 * below is a quiet list of rows rather than a second grid of numbers.
 *
 * Nothing here talks to the server except api.status(); the punch itself still
 * happens on /punch, which owns the camera and the geo-fence.
 */
export default function TodayScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<PunchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Only the newest fetch is allowed to write state.
   *
   * This screen refetches on every focus, so leaving for /punch and coming
   * straight back can leave two `api.status()` calls in flight at once. Without
   * this guard a slow pre-punch response could land after the fresh one and
   * restore the old `canPunchIn`, offering a punch the server has already
   * recorded. The counter — rather than a cleanup flag — also covers a
   * pull-to-refresh racing the focus fetch.
   */
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    try {
      setError(null);
      const next = await api.status();
      if (id !== reqId.current) return;
      setStatus(next);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load today's attendance.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  // Refetch on focus so returning from the camera shows the new punch.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /**
   * Pull-to-refresh drives its own flag. The control used to be bound to
   * `loading`, which `load` only ever lowers — so after the first fetch the
   * spinner snapped back the instant the finger lifted and the pull read as
   * broken.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const nextType = status?.nextPunchType ?? null;
  const canPunch = !!nextType && !!(nextType === "IN" ? status?.canPunchIn : status?.canPunchOut);
  const punches = status?.punches ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title={greeting()}
        subtitle={session?.name || "Employee"}
        right={<NotificationBell />}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        <BirthdayBanner />

        {error ? <Notice>{error}</Notice> : null}

        {/* Today, in one card: both times, the office, the shift. */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroLabel}>TODAY</Text>
            {status?.office ? (
              <StatusPill label={status.office} fg={colors.brand} bg={colors.brandTint} />
            ) : null}
          </View>

          <View style={styles.punchRow}>
            <View style={styles.punchCell}>
              <Text style={styles.punchLabel}>Punch in</Text>
              <Text style={styles.punchTime}>{formatTime(status?.punchIn?.time)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.punchCell}>
              <Text style={styles.punchLabel}>Punch out</Text>
              <Text style={styles.punchTime}>{formatTime(status?.punchOut?.time)}</Text>
            </View>
          </View>

          <Text style={styles.shift}>
            Shift {status?.workStartTime ?? "--"} to {status?.workEndTime ?? "--"}
            {status?.flexibleHours ? " · flexible hours" : ""}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>MARK ATTENDANCE</Text>
          {canPunch && nextType ? (
            <>
              <Muted>
                You'll take a selfie and Attendly will check you're inside an office
                geo-fence before recording the time.
              </Muted>
              <Button
                label={nextType === "IN" ? "Punch in" : "Punch out"}
                onPress={() => router.push({ pathname: "/punch", params: { type: nextType } })}
              />
            </>
          ) : (
            <Notice tone="ok">
              {status?.punchOut
                ? "You're done for today. Both punches are recorded."
                : loading
                  ? "Checking your status..."
                  : "No punch is available right now."}
            </Notice>
          )}
        </View>

        <SectionHeader title="Today's punches" />

        {loading && !status ? <Loading /> : null}

        {punches.map((p, i) => (
          <Row
            key={`${p.time}-${i}`}
            left={
              <View
                style={[
                  styles.logIcon,
                  { backgroundColor: p.type === "IN" ? colors.okTint : colors.warnTint },
                ]}
              >
                <Ionicons
                  name={p.type === "IN" ? "log-in-outline" : "log-out-outline"}
                  size={18}
                  color={p.type === "IN" ? colors.ok : colors.warn}
                />
              </View>
            }
            title={formatTime(p.time)}
            /* The old row carried an IN/OUT pill; keep that in words so the
               direction isn't left to icon colour alone. */
            subtitle={`${p.type === "IN" ? "Punch in" : "Punch out"}${p.office ? ` · ${p.office}` : ""}`}
          />
        ))}

        {status && !punches.length ? (
          <EmptyState
            icon="time-outline"
            title="No punches yet today"
            body="Your punch in and punch out will show up here."
          />
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>DAILY JOURNAL</Text>
          <Muted>Log what you worked on today and what's queued for tomorrow.</Muted>
          <Button
            label="Open today's journal"
            variant="secondary"
            onPress={() => router.push("/journal")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },

  hero: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  heroLabel: { ...type.label, color: colors.muted },
  punchRow: { flexDirection: "row", alignItems: "center" },
  punchCell: { flex: 1, gap: 4 },
  divider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: colors.rule,
    marginHorizontal: spacing.md,
  },
  punchLabel: { ...type.small, color: colors.muted },
  punchTime: { fontSize: 26, fontWeight: "700", color: colors.ink, fontVariant: ["tabular-nums"] },
  shift: { ...type.small, color: colors.inkSoft },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardLabel: { ...type.label, color: colors.muted },

  logIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
