import React, { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError } from "../../src/api/client";
import { adminExtra, Employee } from "../../src/api/admin";
import { Button, Muted, Notice } from "../../src/components/ui";
import {
  Avatar,
  Chip,
  DetailRow,
  EmptyState,
  FilterChips,
  FormField,
  IconButton,
  Loading,
  Row,
  ScreenHeader,
  SearchBar,
  Sheet,
  SheetAction,
  StatStrip,
  StatusPill,
} from "../../src/components/adminui";
import { colors, radius, spacing } from "../../src/theme";
import { formatDate } from "../../src/lib/punch";

/** Longest salary we will accept, in digits. Keeps Number() inside safe ints. */
const MAX_SALARY_DIGITS = 9;

/**
 * 1234567 -> "₹12,34,567".
 *
 * Indian grouping — last three digits, then pairs — matching `money()` on the
 * reports screen, so the same salary reads the same on both admin tabs.
 *
 * Hand-rolled rather than Intl: Hermes on Android ships a cut-down ICU on some
 * builds, so `toLocaleString("en-IN")` silently drops the grouping on exactly
 * the cheap handsets this app targets.
 */
function rupees(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  // String() of anything past ~1e21 is exponential, which would group into junk.
  const s = String(Math.min(Math.round(Math.abs(amount)), Number.MAX_SAFE_INTEGER));
  const last3 = s.length > 3 ? s.slice(-3) : s;
  const rest = s.length > 3 ? s.slice(0, -3) : "";
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${amount < 0 ? "-" : ""}₹${grouped}`;
}

/** Optional fields come back as "" rather than null on this endpoint. */
function dash(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v ? v : "—";
}

/**
 * createdAt is a full "2026-08-22 03:41:20" stamp; formatDate wants the day.
 * Typed as a string but seeded rows on this endpoint have shipped it null, so
 * it is coerced before slicing rather than throwing inside the sheet.
 */
function joinedOn(raw: string | null | undefined): string {
  const day = String(raw ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDate(day) : "—";
}

/** Short month names for reading a birthday back. No Intl — see rupees() above. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "14 May 1990", or "Not set". Typed as a string but the column ships "" for a
 * row nobody recorded one on, and older rows have come back null, so it is
 * matched against a real day before formatting rather than rendering "Invalid Date".
 *
 * Not formatDate(): that is built for attendance days, so it prints the weekday
 * and drops the year — on a date of birth the year is the whole point. This is
 * the shape the employee form reads a birthday back in.
 */
function birthday(raw: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? "").slice(0, 10));
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : "Not set";
}

/** Self-edits already spent. Typed a number, but a row from before the column
 *  existed arrives without it, and a count is never below zero. */
function editsUsed(emp: Employee): number {
  const n = Number(emp.profileEditCount ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function shiftLabel(emp: Employee): string {
  if (!emp.workStartTime || !emp.workEndTime) return "—";
  return `${emp.workStartTime} – ${emp.workEndTime}`;
}

/** Which sheet is up. Only ever one, so the two never stack as nested Modals. */
type SheetKind = "detail" | "salary";

/**
 * The staff directory — the web dashboard's Staff tab.
 *
 * The web row carries eleven columns and four controls. Here the row stays
 * quiet (avatar, name, id, shift, status) and every action lives in the sheet
 * behind a tap; the salary edit gets a second sheet of its own so the number
 * pad has somewhere to go.
 *
 * There is deliberately no delete: the web's DELETE cascades across seven
 * tables with no undo, which is not something to put one tap away on a phone.
 */
export default function AdminStaffScreen() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [salary, setSalary] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await adminExtra.employees();
      // The server sorts newest-first, which is useless for finding a person.
      setEmployees([...res.employees].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the employee list.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch on focus so an edit made on /admin-employee shows on the way back.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Pull-to-refresh drives its own flag. Wiring the control to `loading` showed
   * a spinner under the header on first paint (on top of <Loading />) and then
   * snapped the pull back the instant the finger lifted, since `load` never
   * raises `loading` again after the first call.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const counts = useMemo(() => {
    const list = employees ?? [];
    return {
      all: list.length,
      active: list.filter((e) => e.active).length,
      inactive: list.filter((e) => !e.active).length,
      flexible: list.filter((e) => e.flexibleHours).length,
    };
  }, [employees]);

  const chips: Chip[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "active", label: "Active", count: counts.active },
    { key: "inactive", label: "Inactive", count: counts.inactive },
    { key: "flexible", label: "Flexible", count: counts.flexible },
  ];

  const visible = useMemo(() => {
    const list = employees ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((e) => {
      const passesFilter =
        filter === "all" ||
        (filter === "active" && e.active) ||
        (filter === "inactive" && !e.active) ||
        (filter === "flexible" && e.flexibleHours);
      if (!passesFilter) return false;
      if (!q) return true;
      // There is no server-side search param, so the whole list filters here.
      return `${e.name} ${e.id} ${e.email} ${e.mobileNumber ?? ""}`.toLowerCase().includes(q);
    });
  }, [employees, filter, query]);

  function closeSheets() {
    if (busy) return;
    setSelected(null);
    setSheet(null);
    setSheetError(null);
  }

  /** Dismiss the sheet before pushing, or the modal sits over the new screen. */
  function leaveTo(go: () => void) {
    setSelected(null);
    setSheet(null);
    setSheetError(null);
    go();
  }

  async function act(key: string, fn: () => Promise<unknown>, failure: string) {
    setBusy(key);
    setSheetError(null);
    try {
      await fn();
      await load();
      setSelected(null);
      setSheet(null);
    } catch (e) {
      // Stays open on failure: an error the admin never sees is a silent no-op.
      setSheetError(e instanceof ApiError ? e.message : failure);
    } finally {
      setBusy(null);
    }
  }

  /** Digits only, capped — the field is a number pad, so paste is the only way in. */
  function onSalaryChange(next: string) {
    setSalary(next.replace(/[^0-9]/g, "").slice(0, MAX_SALARY_DIGITS));
  }

  function saveSalary(emp: Employee) {
    const digits = salary.replace(/[^0-9]/g, "").slice(0, MAX_SALARY_DIGITS);
    if (!digits) {
      setSheetError("Enter the monthly salary in rupees.");
      return;
    }
    void act(
      "salary",
      () => adminExtra.updateEmployee(emp.id, { monthlySalary: Number(digits) }),
      `Couldn't update the salary for ${emp.name}.`,
    );
  }

  // A const binding, so the narrowing below survives into the sheet callbacks.
  const emp = selected;
  const salaryPreview = Number(salary.replace(/[^0-9]/g, ""));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="Staff"
        subtitle={employees ? `${counts.all} employees` : "Loading…"}
        right={
          <IconButton
            name="add"
            onPress={() => router.push("/admin-employee")}
            accessibilityLabel="Add employee"
          />
        }
      />

      <View style={styles.controls}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, ID, email or mobile"
        />
        <FilterChips chips={chips} active={filter} onChange={setFilter} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        {employees ? (
          <StatStrip
            stats={[
              { label: "Employees", value: counts.all },
              { label: "Active", value: counts.active, tone: colors.ok },
              { label: "Flexible", value: counts.flexible, tone: colors.brand },
            ]}
          />
        ) : null}

        {loading && !employees ? <Loading /> : null}

        {visible.map((e) => (
          <Row
            key={e.id}
            left={<Avatar name={e.name} />}
            title={e.name}
            subtitle={`${e.id} · ${e.jobRole || "—"}`}
            meta={`${e.department || "No department"} · ${shiftLabel(e)}`}
            right={
              e.active ? (
                <StatusPill label="Active" fg={colors.ok} bg={colors.okTint} />
              ) : (
                <StatusPill label="Inactive" fg={colors.muted} bg={colors.bg} />
              )
            }
            onPress={() => {
              setSelected(e);
              setSheet("detail");
              setSheetError(null);
            }}
          />
        ))}

        {employees && !loading && !visible.length ? (
          <EmptyState
            icon="people-outline"
            title={query || filter !== "all" ? "No one matches" : "No employees yet"}
            body={
              query || filter !== "all"
                ? "Try a different search or filter."
                : "Add your first employee with the + button."
            }
          />
        ) : null}
      </ScrollView>

      {/* Everything about one person: the facts, then the actions. */}
      <Sheet visible={!!emp && sheet === "detail"} title={emp?.name ?? ""} onClose={closeSheets}>
        {emp ? (
          <>
            {sheetError ? <Notice>{sheetError}</Notice> : null}

            <View style={styles.sheetCard}>
              <DetailRow label="Employee ID" value={emp.id} />
              <DetailRow label="Email" value={dash(emp.email)} />
              <DetailRow label="Mobile" value={dash(emp.mobileNumber)} />
              <DetailRow label="Date of birth" value={birthday(emp.dateOfBirth)} />
              <DetailRow label="Self-edits used" value={`${editsUsed(emp)} of 2`} />
              <DetailRow label="Job role" value={dash(emp.jobRole)} />
              <DetailRow label="Department" value={dash(emp.department)} />
              <DetailRow label="Office" value={dash(emp.office)} />
              <DetailRow label="Shift" value={shiftLabel(emp)} />
              <DetailRow label="Flexible hours" value={emp.flexibleHours ? "Yes" : "No"} />
              <DetailRow
                label="Monthly salary"
                value={emp.monthlySalary > 0 ? rupees(emp.monthlySalary) : "Not set"}
              />
              <DetailRow label="Status" value={emp.active ? "Active" : "Inactive"} />
              <DetailRow label="Joined" value={joinedOn(emp.createdAt)} />
            </View>

            <SheetAction
              icon="create-outline"
              label="Edit employee"
              onPress={() =>
                leaveTo(() => router.push({ pathname: "/admin-employee", params: { id: emp.id } }))
              }
            />
            <SheetAction
              icon="calendar-outline"
              label="Month view"
              onPress={() =>
                leaveTo(() =>
                  router.push({
                    pathname: "/admin-employee-month",
                    params: { id: emp.id, name: emp.name },
                  }),
                )
              }
            />
            <SheetAction
              icon="options-outline"
              label="Attendance rules"
              onPress={() =>
                leaveTo(() =>
                  router.push({
                    pathname: "/admin-employee-rules",
                    params: { id: emp.id, name: emp.name },
                  }),
                )
              }
            />
            <SheetAction
              icon="cash-outline"
              label="Set salary"
              onPress={() => {
                // Through the sanitiser: the server has returned salaries as
                // floats ("45000.5"), and a "." cannot be cleared on a numpad.
                onSalaryChange(emp.monthlySalary > 0 ? String(Math.round(emp.monthlySalary)) : "");
                setSheetError(null);
                setSheet("salary");
              }}
            />
            {editsUsed(emp) > 0 ? (
              <SheetAction
                icon="refresh-outline"
                label="Reset edit allowance"
                tone={colors.brand}
                busy={busy === "edits"}
                disabled={!!busy}
                onPress={() =>
                  act(
                    "edits",
                    () => adminExtra.updateEmployee(emp.id, { profileEditCount: 0 }),
                    `Couldn't reset the edit allowance for ${emp.name}.`,
                  )
                }
              />
            ) : null}
            {emp.active ? (
              <SheetAction
                icon="pause-circle-outline"
                label="Deactivate"
                tone={colors.warn}
                busy={busy === "active"}
                disabled={!!busy}
                onPress={() =>
                  act(
                    "active",
                    () => adminExtra.updateEmployee(emp.id, { active: false }),
                    `Couldn't deactivate ${emp.name}.`,
                  )
                }
              />
            ) : (
              <SheetAction
                icon="play-circle-outline"
                label="Activate"
                tone={colors.ok}
                busy={busy === "active"}
                disabled={!!busy}
                onPress={() =>
                  act(
                    "active",
                    () => adminExtra.updateEmployee(emp.id, { active: true }),
                    `Couldn't activate ${emp.name}.`,
                  )
                }
              />
            )}
          </>
        ) : null}
      </Sheet>

      {/* Salary gets its own sheet so the number pad has room. Closing it
          returns to the detail sheet rather than dropping the admin back to
          the list, since it was opened from there. */}
      <Sheet
        visible={!!emp && sheet === "salary"}
        title={emp ? `Salary · ${emp.name}` : ""}
        onClose={() => (busy ? null : setSheet("detail"))}
      >
        {emp ? (
          <>
            {sheetError ? <Notice>{sheetError}</Notice> : null}

            <View style={styles.sheetCard}>
              <FormField
                label="Monthly salary"
                hint="Rupees per month. Payroll divides this across the month's working days."
                value={salary}
                onChangeText={onSalaryChange}
                maxLength={MAX_SALARY_DIGITS}
                keyboardType="number-pad"
                placeholder="0"
                returnKeyType="done"
                required
              />
              <Muted>{salaryPreview > 0 ? rupees(salaryPreview) : "Not set"}</Muted>
            </View>

            <Button label="Save salary" onPress={() => saveSalary(emp)} busy={busy === "salary"} />
          </>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  controls: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  sheetCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
