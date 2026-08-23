import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError } from "../src/api/client";
import { adminExtra, DailyDetail, DayStatus, ReportRow } from "../src/api/admin";
import { Notice } from "../src/components/ui";
import {
  Chip,
  DetailRow,
  EmptyState,
  FilterChips,
  IconButton,
  Loading,
  Row,
  ScreenHeader,
  SectionHeader,
  StatStrip,
  StatusPill,
} from "../src/components/adminui";
import { colors, radius, spacing, type } from "../src/theme";
import { formatDate, formatDuration, formatTime } from "../src/lib/punch";

/**
 * One employee, one month.
 *
 * `/api/admin/reports` has no per-employee variant — it returns the whole
 * company for a month — so this screen pulls the month once and picks its row
 * out of the list. That is heavy enough (every employee x every day) that each
 * month fetched is kept in `cache`, and stepping back to a month already seen
 * is instant. Pull-to-refresh is the way to force a re-fetch.
 *
 * The web modal renders this as a six-column table with no badge at all for
 * half-day, short-day or sunday-worked — those fall through to its
 * `statusBadge.absent` default and read as "Absent", which is wrong. Every
 * status the API can return gets its own pill here.
 */

const CHIP_ORDER: DayStatus[] = [
  "present",
  "late",
  "half-day",
  "short-day",
  "absent",
  "leave",
  "uh",
  "sunday-worked",
  "sunday",
  "holiday",
];

function dayLabel(status: DayStatus): string {
  switch (status) {
    case "present":
      return "Present";
    case "late":
      return "Late";
    case "absent":
      return "Absent";
    case "half-day":
      return "Half day";
    case "short-day":
      return "Short day";
    case "leave":
      return "Leave";
    case "holiday":
      return "Holiday";
    case "sunday":
      return "Weekly off";
    case "sunday-worked":
      return "Sunday worked";
    case "uh":
      return "Unpaid";
    default:
      return status;
  }
}

function dayTone(status: DayStatus): { fg: string; bg: string } {
  switch (status) {
    case "present":
    case "sunday-worked":
      return { fg: colors.ok, bg: colors.okTint };
    case "late":
    case "half-day":
    case "short-day":
      return { fg: colors.warn, bg: colors.warnTint };
    case "absent":
      return { fg: colors.danger, bg: colors.dangerTint };
    case "leave":
    case "uh":
      return { fg: colors.brand, bg: colors.brandTint };
    case "holiday":
    case "sunday":
    default:
      return { fg: colors.muted, bg: colors.bg };
  }
}

/** Route params arrive as `string | string[]`; a repeated key keeps its first value. */
function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.length ? value[0] : "";
  return value ?? "";
}

/** Local YYYY-MM. The report endpoint keys on the office's calendar month. */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonth(month: string): { year: number; index: number } | null {
  const parts = month.split("-");
  const year = Number(parts[0]);
  const monthNo = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(monthNo)) return null;
  return { year, index: monthNo - 1 };
}

function shiftMonth(month: string, delta: number): string {
  const parsed = parseMonth(month);
  if (!parsed) return month;
  const d = new Date(parsed.year, parsed.index + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-08" -> "August 2026" */
function monthLabel(month: string): string {
  const parsed = parseMonth(month);
  if (!parsed) return month;
  return new Date(parsed.year, parsed.index, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${Math.round(pct)}%`;
}

/** Punch pair for the row's soft line. A day with neither punch stays quiet. */
function punchLine(day: DailyDetail): string {
  if (!day.punchIn && !day.punchOut) return "—";
  const punchedIn = day.punchIn ? formatTime(day.punchIn) : "—";
  const punchedOut = day.punchOut ? formatTime(day.punchOut) : "—";
  return `${punchedIn} – ${punchedOut}`;
}

function workLine(day: DailyDetail): string | undefined {
  const parts: string[] = [];
  if (day.durationMinutes) parts.push(formatDuration(day.durationMinutes));
  if (day.breakMinutes) parts.push(`${formatDuration(day.breakMinutes)} break`);
  return parts.length ? parts.join(" · ") : undefined;
}

export default function AdminEmployeeMonthScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const employeeId = firstParam(params.id);
  const employeeName = firstParam(params.name);

  const [month, setMonth] = useState(currentMonth);
  const [cache, setCache] = useState<Record<string, ReportRow | null>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Errors carry the month they belong to. Stepping to a month that is already
  // cached does no fetch, so an unkeyed error would sit there accusing a month
  // whose data loaded fine.
  const [error, setError] = useState<{ month: string; message: string } | null>(null);
  const [filter, setFilter] = useState("all");

  // Month stepping can leave two fetches in flight. Only the newest is allowed
  // to touch the spinner or the error banner; an older one that lands late
  // still writes its own month into the cache, which is always safe.
  const reqRef = useRef(0);

  const load = useCallback(
    async (m: string, mode: "initial" | "refresh" = "initial") => {
      if (!employeeId) return;
      const seq = reqRef.current + 1;
      reqRef.current = seq;
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await adminExtra.report(m);
        const list = Array.isArray(res.employees) ? res.employees : [];
        const found = list.find((e) => e.id === employeeId) ?? null;
        setCache((prev) => ({ ...prev, [m]: found }));
      } catch (e) {
        if (reqRef.current !== seq) return;
        setError({
          month: m,
          message: e instanceof ApiError ? e.message : "Couldn't load this month's attendance.",
        });
      } finally {
        if (reqRef.current === seq) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [employeeId],
  );

  // Fetch only what the cache is missing. A month already pulled re-renders
  // straight from state, so stepping back and forth costs nothing.
  const cached = Object.prototype.hasOwnProperty.call(cache, month);
  useEffect(() => {
    if (cached) return;
    void load(month);
  }, [cached, month, load]);

  const row = cache[month] ?? null;

  const details = useMemo(() => {
    if (!row || !Array.isArray(row.dailyDetails)) return [];
    return [...row.dailyDetails].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [row]);

  const chips = useMemo<Chip[]>(() => {
    const counts = new Map<string, number>();
    for (const d of details) counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
    const byStatus: Chip[] = CHIP_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
      key: s,
      label: dayLabel(s),
      count: counts.get(s) ?? 0,
    }));
    return [{ key: "all", label: "All", count: details.length }, ...byStatus];
  }, [details]);

  // A refresh can drop the status the filter is pinned to, and the chip row
  // hides itself on a one-day month — between them the user could end up stuck
  // on a filter that matches nothing with no chip left to tap. Fall back.
  const activeFilter = useMemo(
    () => (chips.some((c) => c.key === filter) ? filter : "all"),
    [chips, filter],
  );

  const visible = useMemo(
    () => (activeFilter === "all" ? details : details.filter((d) => d.status === activeFilter)),
    [details, activeFilter],
  );

  const atCurrent = month >= currentMonth();

  function go(delta: number) {
    const next = shiftMonth(month, delta);
    if (next > currentMonth()) return; // a month that has not happened has no report
    setFilter("all");
    setMonth(next);
  }

  const title = row?.name || employeeName || "Employee";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={title} subtitle={monthLabel(month)} onBack={() => router.back()} />

      <View style={styles.controls}>
        <View style={styles.monthBar}>
          <IconButton
            name="chevron-back"
            onPress={() => go(-1)}
            accessibilityLabel="Previous month"
          />
          <Text style={styles.monthText}>{monthLabel(month)}</Text>
          <IconButton
            name="chevron-forward"
            onPress={() => go(1)}
            disabled={atCurrent}
            accessibilityLabel="Next month"
          />
        </View>
        {details.length > 1 ? (
          <FilterChips chips={chips} active={activeFilter} onChange={setFilter} />
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(month, "refresh")}
            tintColor={colors.brand}
          />
        }
      >
        {!employeeId ? (
          <Notice>This screen needs an employee. Open it from the staff list.</Notice>
        ) : null}

        {error && error.month === month ? <Notice>{error.message}</Notice> : null}

        {row ? (
          <>
            <StatStrip
              stats={[
                { label: "Present", value: row.presentDays, tone: colors.ok },
                { label: "Absent", value: row.absentDays, tone: colors.danger },
                { label: "Late", value: row.lateDays, tone: colors.warn },
              ]}
            />
            <StatStrip
              stats={[
                { label: "Half day", value: row.halfDays, tone: colors.warn },
                { label: "Leave", value: row.leaveDays, tone: colors.brand },
                { label: "Weekly off", value: row.weeklyOffs },
                { label: "Holiday", value: row.holidayCount },
              ]}
            />

            <View style={styles.card}>
              <DetailRow label="Attendance" value={formatPct(row.attendancePct)} />
              <DetailRow label="Hours worked" value={formatDuration(row.totalWorkedMinutes)} />
              {row.shortDays ? <DetailRow label="Short days" value={String(row.shortDays)} /> : null}
              {row.sundayWorkedDays ? (
                <DetailRow label="Sundays worked" value={String(row.sundayWorkedDays)} />
              ) : null}
              {row.uhDays ? <DetailRow label="Unpaid holidays" value={String(row.uhDays)} /> : null}
              <DetailRow label="Shift" value={row.shift} />
              <DetailRow label="Employee ID" value={row.id} />
            </View>

            {details.length ? <SectionHeader title="Day by day" /> : null}
          </>
        ) : null}

        {loading && !row ? <Loading /> : null}

        {visible.map((day) => {
          const t = dayTone(day.status);
          return (
            <Row
              key={day.date}
              title={formatDate(day.date)}
              subtitle={punchLine(day)}
              meta={workLine(day)}
              right={<StatusPill label={dayLabel(day.status)} fg={t.fg} bg={t.bg} />}
            />
          );
        })}

        {!loading && employeeId && cached && !row ? (
          <EmptyState
            icon="person-outline"
            title="Nothing for this month"
            body={`${title} has no report row for ${monthLabel(month)}.`}
          />
        ) : null}

        {row && !details.length ? (
          <EmptyState
            icon="calendar-outline"
            title="No days recorded"
            body={`${monthLabel(month)} came back without a single day.`}
          />
        ) : null}

        {row && details.length > 0 && !visible.length ? (
          <EmptyState icon="funnel-outline" title="No days match" body="Try a different filter." />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  controls: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  monthText: { ...type.heading, color: colors.ink },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
