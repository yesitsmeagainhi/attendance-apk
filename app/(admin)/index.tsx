import React, { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError } from "../../src/api/client";
import { adminApi, DailyAttendance } from "../../src/api/admin";
import { useAuth } from "../../src/auth/AuthContext";
import { Notice } from "../../src/components/ui";
import { Avatar, ScreenHeader, SectionHeader } from "../../src/components/adminui";
import { BirthdayBanner } from "../../src/components/BirthdayBanner";
import { NotificationBell } from "../../src/components/NotificationBell";
import { colors, radius, spacing, type } from "../../src/theme";

/** Local YYYY-MM-DD — the roster endpoint keys on the office's calendar day. */
function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

type Tile = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  tint: string;
  bg: string;
  route: string;
  /** A badge means someone is waiting on the admin. Nothing else earns one. */
  badge?: number;
};

const GRID_GAP = spacing.sm;

/**
 * The admin home.
 *
 * It used to open straight onto the 68-row roster, which made the roster the
 * whole app and buried everything else behind tabs. Now it answers "how is
 * today going" in one card and hands off to each area as a tile — the roster
 * included, on its own screen where it has room.
 *
 * The four counts come from separate endpoints, fetched together but failing
 * independently: a dead OTP call must not blank the attendance summary. A count
 * that fails resets to null rather than keeping its old value, because a badge
 * showing a number from two minutes ago is worse than no badge at all.
 */
export default function AdminHomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { width } = useWindowDimensions();

  const [day, setDay] = useState<DailyAttendance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<number | null>(null);
  const [pendingLeaves, setPendingLeaves] = useState<number | null>(null);
  const [waitingCodes, setWaitingCodes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const today = isoDay(new Date());

    try {
      const [roster, miss, leave, otp] = await Promise.allSettled([
        adminApi.dailyAttendance(today),
        adminApi.missPunches(),
        adminApi.leaves(),
        adminApi.otpRequests(),
      ]);

      if (roster.status === "fulfilled" && roster.value) {
        setDay(roster.value);
      } else {
        setDay(null);
        const e = roster.status === "rejected" ? roster.reason : null;
        setError(e instanceof ApiError ? e.message : "Couldn't load today's attendance.");
      }

      // Each count clears on failure so a stale number never masquerades as live.
      setPendingRequests(
        miss.status === "fulfilled" && miss.value?.requests
          ? miss.value.requests.filter((r) => r.status === "pending").length
          : null,
      );
      setPendingLeaves(
        leave.status === "fulfilled" && leave.value?.requests
          ? leave.value.requests.filter((r) => r.status === "pending").length
          : null,
      );
      setWaitingCodes(
        otp.status === "fulfilled" && otp.value?.otpRequests
          ? otp.value.otpRequests.length
          : null,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the dashboard.");
    } finally {
      setLoaded(true);
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const list = day?.employees ?? [];
  const present = list.filter((e) => e.status === "present").length;
  const late = list.filter((e) => e.status === "late").length;
  const absent = list.filter((e) => e.status === "absent").length;
  // Unpaid holiday is a first-class status — "mark all unpaid" sets it for the
  // whole office. Leaving it out of the buckets made a fully marked day read as
  // partially marked, and a whole-office holiday render as an empty bar.
  const unpaid = list.filter((e) => e.status === "unpaid_holiday").length;
  const notMarked = list.filter((e) => e.status === "not_marked").length;
  const total = day?.summary.total ?? 0;
  const checkedIn = present + late;
  const hasData = !!day && total > 0;
  const rate = hasData ? Math.round((checkedIn / total) * 100) : 0;
  const rateTone = !hasData
    ? colors.muted
    : rate >= 75
      ? colors.ok
      : rate >= 50
        ? colors.warn
        : colors.danger;
  const barTotal = present + late + absent + unpaid + notMarked;

  const subtitle = !loaded
    ? "Loading…"
    : error
      ? "Couldn't load today"
      : !total
        ? "No employees on the roster"
        : day?.isHoliday
          ? "Marked as a holiday"
          : notMarked
            ? `${notMarked} still not marked`
            : "Everyone is accounted for";

  // Exact thirds: percentage widths left a ragged edge and collapsed to two
  // columns once Android display scaling shrank the effective width.
  const tileSize = Math.floor((width - spacing.lg * 2 - GRID_GAP * 2) / 3);

  const tiles: Tile[] = [
    {
      key: "attendance",
      label: "Attendance",
      icon: "checkbox-outline",
      tint: colors.brand,
      bg: colors.brandTint,
      route: "/admin-attendance",
      // No badge: "not marked" is the normal state of a fresh day, and the card
      // above already says the number.
    },
    {
      key: "staff",
      label: "Staff",
      icon: "people-outline",
      tint: "#1D6FB8",
      bg: "#E8F1FA",
      route: "/(admin)/staff",
    },
    {
      key: "codes",
      label: "Login codes",
      icon: "key-outline",
      tint: colors.warn,
      bg: colors.warnTint,
      route: "/admin-codes",
      badge: waitingCodes || undefined,
    },
    {
      key: "requests",
      label: "Requests",
      icon: "mail-outline",
      tint: "#B0348C",
      bg: "#FBEBF6",
      route: "/(admin)/requests",
      badge: (pendingRequests ?? 0) + (pendingLeaves ?? 0) || undefined,
    },
    {
      key: "reports",
      label: "Reports",
      icon: "bar-chart-outline",
      tint: colors.ok,
      bg: colors.okTint,
      route: "/(admin)/reports",
    },
    {
      key: "journals",
      label: "Journals",
      icon: "book-outline",
      tint: "#7A5AF8",
      bg: "#F0EDFE",
      route: "/admin-journals",
    },
    {
      key: "activity",
      label: "Activity log",
      icon: "time-outline",
      tint: colors.inkSoft,
      bg: "#EFEEF4",
      route: "/admin-history",
    },
    {
      key: "settings",
      label: "Settings",
      icon: "settings-outline",
      tint: "#0F766E",
      bg: "#E6F4F2",
      route: "/admin-settings",
    },
    {
      key: "profile",
      label: "My account",
      icon: "person-outline",
      tint: colors.muted,
      bg: "#EFEEF4",
      route: "/admin-profile",
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title={greeting()}
        subtitle={session?.name ? `${session.name} · ${session.role ?? "admin"}` : undefined}
        right={
          <View style={styles.headerActions}>
            <NotificationBell />
            <Avatar name={session?.name || "Admin"} size={38} />
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        <BirthdayBanner />

        {error ? <Notice>{error}</Notice> : null}

        {/* Today, in one card: the rate, the split, and what is still open. */}
        <Pressable
          onPress={() => router.push("/admin-attendance")}
          accessibilityRole="button"
          accessibilityLabel="Open today's attendance"
          style={({ pressed }) => [styles.summary, { opacity: pressed ? 0.9 : 1 }]}
        >
          <View style={styles.summaryTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryLabel}>TODAY</Text>
              <Text style={styles.summaryHead}>
                {hasData ? `${checkedIn} of ${total} checked in` : "Attendance"}
              </Text>
              <Text style={styles.summarySub}>{subtitle}</Text>
            </View>
            <View style={[styles.rate, { borderColor: rateTone }]}>
              <Text
                style={[styles.rateValue, { color: rateTone }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {hasData ? `${rate}%` : "—"}
              </Text>
            </View>
          </View>

          <View style={styles.bar}>
            {barTotal > 0 ? (
              <>
                {present > 0 ? <View style={{ flex: present, backgroundColor: colors.ok }} /> : null}
                {late > 0 ? <View style={{ flex: late, backgroundColor: colors.warn }} /> : null}
                {absent > 0 ? (
                  <View style={{ flex: absent, backgroundColor: colors.danger }} />
                ) : null}
                {unpaid > 0 ? (
                  <View style={{ flex: unpaid, backgroundColor: colors.brand }} />
                ) : null}
                {notMarked > 0 ? (
                  <View style={{ flex: notMarked, backgroundColor: colors.rule }} />
                ) : null}
              </>
            ) : (
              <View style={{ flex: 1, backgroundColor: colors.rule }} />
            )}
          </View>

          <View style={styles.legend}>
            <Legend label="Present" value={present} tone={colors.ok} />
            <Legend label="Late" value={late} tone={colors.warn} />
            <Legend label="Absent" value={absent} tone={colors.danger} />
            {unpaid > 0 ? <Legend label="Unpaid" value={unpaid} tone={colors.brand} /> : null}
            <Legend label="Not marked" value={notMarked} tone={colors.rule} />
          </View>
        </Pressable>

        <SectionHeader title="Everything else" />

        <View style={styles.grid}>
          {tiles.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => router.push(t.route as never)}
              accessibilityRole="button"
              accessibilityLabel={t.label}
              style={({ pressed }) => [
                styles.tile,
                { width: tileSize, height: tileSize, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <View style={[styles.tileIcon, { backgroundColor: t.bg }]}>
                <Ionicons name={t.icon} size={22} color={t.tint} />
                {t.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{t.badge > 99 ? "99+" : t.badge}</Text>
                  </View>
                ) : null}
              </View>
              {/* Two lines: "Login codes" and "Activity log" clip at one line
                  once Android font scaling is turned up. */}
              <Text style={styles.tileLabel} numberOfLines={2}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Legend({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={styles.legendText}>
        {label} {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, paddingBottom: spacing.xxl },

  summary: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  summaryLabel: { ...type.label, color: colors.muted },
  summaryHead: { ...type.title, color: colors.ink, marginTop: 2 },
  summarySub: { ...type.small, color: colors.inkSoft, marginTop: 2 },
  rate: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 4,
  },
  rateValue: { ...type.title, fontSize: 18 },

  // No gap between segments: a fully present day must read as one solid bar,
  // not as one with white notches punched through it.
  bar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden" },

  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...type.small, color: colors.inkSoft, fontSize: 12 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  tile: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: 6,
  },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: { ...type.small, color: colors.ink, fontWeight: "600", textAlign: "center" },
  badge: {
    position: "absolute",
    top: -5,
    right: -7,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.card,
  },
  badgeText: { ...type.small, color: colors.white, fontSize: 11, fontWeight: "700" },
});
