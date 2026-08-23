import React, { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { api, ApiError, Timesheet, TimesheetDay } from "../../src/api/client";
import { Notice } from "../../src/components/ui";
import {
  EmptyState,
  IconButton,
  Loading,
  Row,
  ScreenHeader,
  SectionHeader,
  StatStrip,
  StatusPill,
} from "../../src/components/adminui";
import { NotificationBell } from "../../src/components/NotificationBell";
import { colors, radius, spacing, type } from "../../src/theme";
import { formatDuration, formatTime } from "../../src/lib/punch";

/**
 * The employee timesheet: one month of days, with the month's totals on top.
 *
 * The old cut stacked a hero hours number, a four-up mini stat block and a
 * hand-rolled row carrying the date, both punches, the status word and the
 * duration in four different type sizes. Here every number lives in one
 * StatStrip and each day is a quiet Row — date badge, the punch pair, the hours
 * under it, and the status as a pill on the right.
 *
 * The endpoint is untouched: api.timesheet(month) with a "YYYY-MM" string.
 */
export default function TimesheetScreen() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<Timesheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Which fetch owns the screen. Stepping two months back quickly puts two
   * requests in flight and they can land out of order, which would paint
   * June's totals under July's heading. Only the newest ticket may write.
   */
  const ticketRef = useRef(0);

  /**
   * Which ticket currently owns the `loading` flag. Only a foreground load
   * raises it, so only a newer foreground load may take the duty to lower it:
   *
   *  - an overtaken foreground load must NOT lower a spinner its successor is
   *    still standing behind, or two quick taps on "previous month" blank the
   *    screen — no spinner, no rows, no notice — until the second fetch lands;
   *  - a background pull-to-refresh must NOT inherit that duty, or a refresh
   *    started over a first paint strands the spinner up forever.
   */
  const loadingTicketRef = useRef(0);

  const load = useCallback(async (m: string, background = false) => {
    const ticket = ++ticketRef.current;
    if (!background) {
      loadingTicketRef.current = ticket;
      setLoading(true);
    }
    setError(null);
    try {
      const res = await api.timesheet(m);
      if (ticket !== ticketRef.current) return;
      setData(res);
    } catch (e) {
      if (ticket !== ticketRef.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load your timesheet.");
    } finally {
      if (!background && loadingTicketRef.current === ticket) setLoading(false);
    }
  }, []);

  // Same trigger as before: on focus, and again whenever the month changes.
  useFocusEffect(
    useCallback(() => {
      void load(month);
    }, [load, month]),
  );

  /** Pull-to-refresh drives its own flag. Sharing `loading` would show the
   *  spinner under the header on first paint and snap the pull straight back. */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(month, true);
    } finally {
      setRefreshing(false);
    }
  }, [load, month]);

  /** Drop the old month's numbers immediately — they must never sit under a
   *  heading that has moved on, least of all if the next fetch then fails. */
  function goToMonth(next: string) {
    if (next === month) return;
    setData(null);
    setError(null);
    setMonth(next);
  }

  const days = data?.days ?? [];
  const atLatest = month >= currentMonth();
  const subtitle =
    loading && !data ? "Loading…" : !data && error ? "Couldn't load" : monthLabel(month);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Timesheet" subtitle={subtitle} right={<NotificationBell />} />

      <View style={styles.monthBar}>
        <IconButton
          name="chevron-back"
          onPress={() => goToMonth(shiftMonth(month, -1))}
          accessibilityLabel="Previous month"
        />
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <IconButton
          name="chevron-forward"
          onPress={() => goToMonth(shiftMonth(month, 1))}
          disabled={atLatest}
          accessibilityLabel="Next month"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        {data ? (
          <StatStrip
            stats={[
              { label: "Hours", value: hoursLabel(data.totalHoursWorked) },
              { label: "Present", value: data.presentDays, tone: colors.ok },
              { label: "Half", value: data.halfDays, tone: colors.warn },
              { label: "Leave", value: data.leaveDays, tone: colors.brand },
              { label: "Absent", value: data.absentDays, tone: colors.danger },
            ]}
          />
        ) : null}

        {loading && !data ? <Loading /> : null}

        {days.length ? <SectionHeader title="Day by day" /> : null}

        {days.map((d) => (
          <DayRow key={d.date} day={d} />
        ))}

        {data && !days.length ? (
          <EmptyState
            icon="calendar-outline"
            title="Nothing logged this month"
            body={
              atLatest
                ? "Days appear here as you punch in and out."
                : "No attendance was recorded for this month."
            }
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DayRow({ day }: { day: TimesheetDay }) {
  const tone = statusTone(day.status);
  const worked = day.duration != null && day.duration > 0;

  return (
    <Row
      left={
        <View style={styles.badge}>
          <Text style={styles.badgeDay}>{day.date.slice(8)}</Text>
          <Text style={styles.badgeDow}>{DAY_NAMES[day.dayOfWeek] ?? ""}</Text>
        </View>
      }
      title={punchLine(day)}
      subtitle={worked ? `${formatDuration(day.duration)} worked` : undefined}
      right={<StatusPill label={statusLabel(day.status)} fg={tone.fg} bg={tone.bg} />}
    />
  );
}

/** "9:05 AM – 6:35 PM", or a plain line on a day with nothing to show. */
function punchLine(day: TimesheetDay): string {
  if (!day.punchIn && !day.punchOut) return "No punches";
  return `${formatTime(day.punchIn)} – ${formatTime(day.punchOut)}`;
}

/**
 * The timesheet endpoint speaks the same day-status vocabulary as the admin
 * reports — "half-day", "sunday-worked", "uh" — not the title-cased strings the
 * history API returns, so theme's statusColors() would drop every one of them
 * into the neutral bucket. Normalised here instead, and anything the server
 * adds later still renders: it falls through to its own text, tidied up.
 */
function statusKey(status: string | null | undefined): string {
  // Coerced before trimming. The type says string, but this is a live server
  // and a day it holds no report row for can come back with a null status —
  // the old cut rendered {day.status} and simply drew nothing, whereas a bare
  // .trim() here would take the whole timesheet down with a red screen.
  return typeof status === "string" ? status.trim().toLowerCase().replace(/[\s_]+/g, "-") : "";
}

const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  "on-time": "On time",
  late: "Late",
  absent: "Absent",
  "half-day": "Half day",
  "short-day": "Short day",
  leave: "Leave",
  holiday: "Holiday",
  sunday: "Week off",
  "weekly-off": "Week off",
  "sunday-worked": "Sunday",
  uh: "Unpaid",
  "unpaid-holiday": "Unpaid",
  "not-marked": "Not marked",
};

const STATUS_TONES: Record<string, { fg: string; bg: string }> = {
  present: { fg: colors.ok, bg: colors.okTint },
  "on-time": { fg: colors.ok, bg: colors.okTint },
  "sunday-worked": { fg: colors.ok, bg: colors.okTint },
  late: { fg: colors.warn, bg: colors.warnTint },
  "half-day": { fg: colors.warn, bg: colors.warnTint },
  "short-day": { fg: colors.warn, bg: colors.warnTint },
  absent: { fg: colors.danger, bg: colors.dangerTint },
  leave: { fg: colors.brand, bg: colors.brandTint },
  uh: { fg: colors.brand, bg: colors.brandTint },
  "unpaid-holiday": { fg: colors.brand, bg: colors.brandTint },
};

/** Neutral pill for week offs, holidays and anything unrecognised. */
const NEUTRAL_TONE = { fg: colors.inkSoft, bg: colors.bg };

function statusTone(status: string | null | undefined): { fg: string; bg: string } {
  return STATUS_TONES[statusKey(status)] ?? NEUTRAL_TONE;
}

function statusLabel(status: string | null | undefined): string {
  const key = statusKey(status);
  const known = STATUS_LABELS[key];
  if (known) return known;
  const words = key.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "—";
}

/**
 * 152 -> "152", 152.53 -> "152.5". Never renders a float's full tail.
 *
 * The value is coerced first because totalHoursWorked is a SQL SUM and the
 * endpoint has been seen returning it as a numeric string. Number.isFinite()
 * is type-strict, so testing the raw value would answer false for "152.53" and
 * print an em dash where the old screen printed the employee's real total.
 */
function hoursLabel(hours: number | string | null | undefined): string {
  const n = typeof hours === "string" ? Number(hours) : hours;
  if (n == null || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** The timesheet API returns dayOfWeek as a JS day index, not a name. */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return next > currentMonth() ? currentMonth() : next;
}

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },

  // Transparent: the two round IconButtons read as the control, and the month
  // reads as the heading sitting between them.
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  monthLabel: { ...type.heading, color: colors.ink },

  // colors.bg on colors.card — the badge is a well punched into the row, so it
  // never competes with the punch times beside it.
  badge: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeDay: { ...type.heading, color: colors.ink, fontVariant: ["tabular-nums"] },
  badgeDow: { fontSize: 10, fontWeight: "600", color: colors.muted, letterSpacing: 0.4 },
});
