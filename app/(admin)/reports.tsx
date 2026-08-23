import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ApiError } from "../../src/api/client";
import { adminExtra, PayrollRow, ReportRow } from "../../src/api/admin";
import { Muted, Notice } from "../../src/components/ui";
import {
  Avatar,
  DetailRow,
  EmptyState,
  IconButton,
  Loading,
  Row,
  ScreenHeader,
  SearchBar,
  Segmented,
  Sheet,
  SheetAction,
  StatStrip,
  StatusPill,
} from "../../src/components/adminui";
import { colors, radius, spacing, type } from "../../src/theme";
import { formatDuration } from "../../src/lib/punch";

type Seg = "attendance" | "payroll";

type ReportData = { month: string; workingDays: number; employees: ReportRow[] };
type PayrollData = {
  month: string;
  workingDays: number;
  totalHolidays: number;
  employees: PayrollRow[];
};

// ---------------------------------------------------------------- helpers

/** Local YYYY-MM. Both report endpoints key on the office's calendar month. */
function isoMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthParts(m: string): { year: number; month: number } {
  return { year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) };
}

function shiftMonth(m: string, delta: number): string {
  const { year, month } = monthParts(m);
  return isoMonth(new Date(year, month - 1 + delta, 1));
}

/** "2026-08" -> "August 2026" */
function prettyMonth(m: string): string {
  const { year, month } = monthParts(m);
  const d = new Date(year, month - 1, 1);
  if (isNaN(d.getTime())) return m;
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * Indian grouping without a library: 1234567 -> "₹12,34,567".
 * Last three digits, then pairs — `toLocaleString("en-IN")` is not dependable
 * on Android's trimmed-down ICU, so the grouping is done by hand.
 */
function money(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const s = String(rounded);
  const last3 = s.length > 3 ? s.slice(-3) : s;
  const rest = s.length > 3 ? s.slice(0, -3) : "";
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${n < 0 ? "-" : ""}₹${grouped}`;
}

/** Compact form for the stat strip, where a full ₹12,34,567 overflows a third of the screen. */
function moneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  return money(n);
}

/** Day counts arrive in half-day steps, so they are not always whole numbers. */
function dayNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function dayCount(n: number): string {
  return `${dayNumber(n)} ${n === 1 ? "day" : "days"}`;
}

function pctTone(pct: number): { fg: string; bg: string } {
  if (pct >= 90) return { fg: colors.ok, bg: colors.okTint };
  if (pct >= 75) return { fg: colors.warn, bg: colors.warnTint };
  return { fg: colors.danger, bg: colors.dangerTint };
}

function matching<T extends { id: string; name: string }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
}

/**
 * Monthly attendance and payroll.
 *
 * The web puts both of these in wide tables with a dozen columns each; on a
 * phone that reads as noise, so each employee is one quiet row — the numbers
 * that matter at a glance in the subtitle, everything else behind a tap.
 *
 * Two things worth knowing about the data:
 *
 * 1. `shortDays` (a day worked for less than half a shift) is counted by the
 *    payroll route but never returned — the response's absentDays is derived as
 *    workDays − present − half, so those days silently land in absent. There is
 *    no field to display, and inventing one would be wrong.
 * 2. The web sums every row for its TOTALS line while the table above it is
 *    filtered by the search box, so the two disagree the moment anyone types.
 *    Here the strip sums exactly the rows on screen, and says so underneath.
 */
export default function AdminReportsScreen() {
  const [month, setMonth] = useState(() => isoMonth(new Date()));
  const [seg, setSeg] = useState<Seg>("attendance");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PayrollRow | null>(null);

  // Cached per month, per segment: a month that has closed never changes, and
  // stepping back and forth should not re-hit a report that takes seconds.
  // The value is explicitly optional so strict mode keeps checking the misses.
  const [reports, setReports] = useState<Record<string, ReportData | undefined>>({});
  const [payrolls, setPayrolls] = useState<Record<string, PayrollData | undefined>>({});

  // Which month+segment the screen is showing. A report can take seconds, so a
  // slower request for a view the admin has already left must not land on top
  // of the one they are looking at now — its error and its spinner both belong
  // to a screen that is gone.
  const active = useRef<string>(`${seg}:${month}`);

  const load = useCallback(async (m: string, s: Seg) => {
    const key = `${s}:${m}`;
    active.current = key;
    setError(null);
    try {
      if (s === "attendance") {
        const data = await adminExtra.report(m);
        // Cache it either way — the month may be revisited — but only the
        // current view gets to touch the shared loading/error state.
        setReports((prev) => ({ ...prev, [m]: data }));
      } else {
        const data = await adminExtra.payroll(m);
        setPayrolls((prev) => ({ ...prev, [m]: data }));
      }
    } catch (e) {
      if (active.current !== key) return;
      const fallback =
        s === "attendance"
          ? "Couldn't load the attendance report for this month."
          : "Couldn't load payroll for this month.";
      setError(e instanceof ApiError ? e.message : fallback);
    } finally {
      if (active.current === key) setLoading(false);
    }
  }, []);

  const report = reports[month];
  const payroll = payrolls[month];
  // Only the cache entry actually on screen may retrigger the fetch. Depending
  // on both would re-fire this segment's request every time the *other*
  // segment's response landed.
  const cached: ReportData | PayrollData | undefined = seg === "attendance" ? report : payroll;

  useEffect(() => {
    // Only the segment on screen is fetched; the other one costs a second
    // request the admin may never look at.
    if (cached) {
      // Claim the screen, so an in-flight request for the view just left is
      // dropped when it resolves rather than flashing its error over this one.
      active.current = `${seg}:${month}`;
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void load(month, seg);
  }, [month, seg, cached, load]);

  const thisMonth = isoMonth(new Date());
  const atCurrent = month >= thisMonth;

  function go(delta: number) {
    const next = shiftMonth(month, delta);
    if (next > thisMonth) return; // a month that hasn't happened has no report
    setError(null);
    setMonth(next);
  }

  function refresh() {
    setLoading(true);
    void load(month, seg);
  }

  const attRows = useMemo(() => matching(report?.employees ?? [], query), [report, query]);
  const payRows = useMemo(() => matching(payroll?.employees ?? [], query), [payroll, query]);

  const attTotals = useMemo(() => {
    const absent = attRows.reduce((sum, r) => sum + r.absentDays, 0);
    const avg = attRows.length
      ? Math.round(attRows.reduce((sum, r) => sum + r.attendancePct, 0) / attRows.length)
      : 0;
    return { absent, avg };
  }, [attRows]);

  const payTotals = useMemo(
    () =>
      payRows.reduce(
        (acc, r) => ({
          salary: acc.salary + r.monthlySalary,
          deduction: acc.deduction + r.deduction,
          net: acc.net + r.netPay,
        }),
        { salary: 0, deduction: 0, net: 0 },
      ),
    [payRows],
  );

  const workingDays = cached?.workingDays;
  const hasData = !!cached;
  const rowCount = seg === "attendance" ? attRows.length : payRows.length;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="Reports"
        subtitle={
          workingDays === undefined
            ? `${prettyMonth(month)} · loading…`
            : `${prettyMonth(month)} · ${workingDays} working days`
        }
      />

      <View style={styles.controls}>
        <View style={styles.monthBar}>
          <IconButton
            name="chevron-back"
            onPress={() => go(-1)}
            accessibilityLabel="Previous month"
          />
          <Text style={styles.monthText}>{prettyMonth(month)}</Text>
          <IconButton
            name="chevron-forward"
            onPress={() => go(1)}
            disabled={atCurrent}
            accessibilityLabel="Next month"
          />
        </View>
        <Segmented
          options={[
            { key: "attendance", label: "Attendance" },
            { key: "payroll", label: "Payroll" },
          ]}
          active={seg}
          onChange={(key) => setSeg(key === "payroll" ? "payroll" : "attendance")}
        />
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search name or ID" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          // Only a pull on an already-populated list spins here; the first load
          // has <Loading /> below it, and showing both reads as two spinners.
          <RefreshControl
            refreshing={loading && hasData}
            onRefresh={refresh}
            tintColor={colors.brand}
          />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        {loading && !hasData ? <Loading /> : null}

        {hasData && rowCount > 0 && seg === "attendance" ? (
          <>
            <StatStrip
              stats={[
                { label: "Employees", value: attRows.length },
                {
                  label: "Avg attendance",
                  value: `${attTotals.avg}%`,
                  tone: pctTone(attTotals.avg).fg,
                },
                {
                  label: "Absent days",
                  value: dayNumber(attTotals.absent),
                  tone: attTotals.absent ? colors.danger : undefined,
                },
              ]}
            />
            <Muted>
              {`Averaged over the ${rowCount} ${rowCount === 1 ? "employee" : "employees"} listed below.`}
            </Muted>

            {attRows.map((r) => {
              const t = pctTone(r.attendancePct);
              return (
                <Row
                  key={r.id}
                  left={<Avatar name={r.name} />}
                  title={r.name}
                  subtitle={`${r.presentDays}P · ${r.absentDays}A · ${r.lateDays}L · ${r.halfDays}H`}
                  meta={formatDuration(r.totalWorkedMinutes)}
                  right={<StatusPill label={`${r.attendancePct}%`} fg={t.fg} bg={t.bg} />}
                  onPress={() =>
                    router.push({
                      pathname: "/admin-employee-month",
                      params: { id: r.id, name: r.name },
                    })
                  }
                />
              );
            })}
          </>
        ) : null}

        {hasData && rowCount > 0 && seg === "payroll" ? (
          <>
            <StatStrip
              stats={[
                { label: "Salary", value: moneyShort(payTotals.salary) },
                {
                  label: "Deduction",
                  value: moneyShort(payTotals.deduction),
                  tone: payTotals.deduction ? colors.danger : undefined,
                },
                { label: "Net pay", value: moneyShort(payTotals.net), tone: colors.ok },
              ]}
            />
            <Muted>
              {`Net pay ${money(payTotals.net)} across the ${rowCount} ${
                rowCount === 1 ? "employee" : "employees"
              } listed below — the search narrows these totals too.${
                payroll?.totalHolidays ? ` ${payroll.totalHolidays} holidays this month.` : ""
              }`}
            </Muted>

            {payRows.map((r) => (
              <Row
                key={r.id}
                left={<Avatar name={r.name} />}
                title={r.name}
                subtitle={`${money(r.monthlySalary)} · ${r.presentDays}/${r.workingDays} days`}
                meta={`Deduction ${money(r.deduction)} · Bonus ${money(r.sundayBonus)}`}
                right={<Text style={styles.net}>{money(r.netPay)}</Text>}
                onPress={() => setSelected(r)}
              />
            ))}
          </>
        ) : null}

        {!loading && hasData && !rowCount ? (
          <EmptyState
            icon={query ? "search-outline" : "bar-chart-outline"}
            title={query ? "No one matches" : "Nothing to report"}
            body={
              query
                ? "Try a different name or employee ID."
                : "No attendance was recorded for this month."
            }
          />
        ) : null}
      </ScrollView>

      {/* Payroll breakdown. The web computes halfDays and then never shows it,
          which makes its absent column look wrong; every field is here. */}
      <Sheet
        visible={!!selected}
        title={selected?.name ?? ""}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <>
            <View style={styles.sheetCard}>
              <DetailRow label="Employee ID" value={selected.id} />
              <DetailRow label="Month" value={prettyMonth(month)} />
              <DetailRow label="Monthly salary" value={money(selected.monthlySalary)} />
              <DetailRow label="Working days" value={String(selected.workingDays)} />
            </View>

            <View style={styles.sheetCard}>
              <DetailRow label="Present" value={dayCount(selected.presentDays)} />
              <DetailRow label="Absent" value={dayCount(selected.absentDays)} />
              <DetailRow label="Half days" value={dayCount(selected.halfDays)} />
              <DetailRow label="Leave" value={dayCount(selected.leaveDays)} />
              <DetailRow label="Late marks" value={dayCount(selected.lateDays)} />
              <DetailRow label="Late counted absent" value={dayCount(selected.lateAbsentDays)} />
              <DetailRow label="Sundays worked" value={dayCount(selected.sundayWorkedDays)} />
            </View>

            <View style={styles.sheetCard}>
              <DetailRow label="Deduction" value={money(selected.deduction)} />
              <DetailRow label="Sunday bonus" value={money(selected.sundayBonus)} />
              <DetailRow label="Net pay" value={money(selected.netPay)} />
            </View>

            <View style={styles.sheetCard}>
              <Text style={styles.sheetNote}>
                <Ionicons name="information-circle-outline" size={14} color={colors.muted} /> A day
                worked for less than half a shift is not returned separately by the server, so it is
                already counted inside Absent.
              </Text>
            </View>

            <SheetAction
              icon="calendar-outline"
              label="See the day-by-day month"
              tone={colors.brand}
              onPress={() => {
                const { id, name } = selected;
                setSelected(null);
                router.push({ pathname: "/admin-employee-month", params: { id, name } });
              }}
            />
          </>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
  net: { ...type.body, color: colors.ink, fontWeight: "700" },
  sheetCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetNote: { ...type.small, color: colors.inkSoft, lineHeight: 19 },
});
