import React, { useCallback, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError } from "../src/api/client";
import {
  adminApi,
  AttendanceStatus,
  DailyAttendance,
  RosterEmployee,
} from "../src/api/admin";
import { Notice } from "../src/components/ui";
import {
  Avatar,
  Chip,
  DetailRow,
  EmptyState,
  FilterChips,
  IconButton,
  Loading,
  Row,
  ScreenHeader,
  SearchBar,
  Sheet,
  SheetAction,
  StatStrip,
  StatusPill,
} from "../src/components/adminui";
import { PhotoViewer, PunchThumb } from "../src/components/PunchPhoto";
import { colors, radius, spacing, type } from "../src/theme";
import { formatDuration, formatTime } from "../src/lib/punch";

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  not_marked: "Not marked",
  unpaid_holiday: "Unpaid",
};

function tone(status: AttendanceStatus): { fg: string; bg: string } {
  switch (status) {
    case "present":
      return { fg: colors.ok, bg: colors.okTint };
    case "late":
      return { fg: colors.warn, bg: colors.warnTint };
    case "absent":
      return { fg: colors.danger, bg: colors.dangerTint };
    case "unpaid_holiday":
      return { fg: colors.brand, bg: colors.brandTint };
    default:
      return { fg: colors.muted, bg: colors.bg };
  }
}

/** Local YYYY-MM-DD — the roster endpoint keys on the office's calendar day. */
function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

function prettyDay(iso: string): string {
  const today = isoDay(new Date());
  if (iso === today) return "Today";
  if (iso === shiftDay(today, -1)) return "Yesterday";
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The admin home: one day's roster for the whole office.
 *
 * At 68 employees the web dashboard's inline action buttons become a wall, so
 * the row stays quiet — avatar, name, times, status — and every action lives in
 * a sheet behind a tap. Search and status chips do the work the web does with a
 * table header.
 *
 * Admins are filtered out of this list server-side, by design.
 */
export default function AdminAttendanceScreen() {
  const router = useRouter();
  const [date, setDate] = useState(() => isoDay(new Date()));
  const [data, setData] = useState<DailyAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<RosterEmployee | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Guards against a slow response for a day the admin has already stepped away
   * from. Without it, yesterday's roster could land under today's heading — and
   * a mark issued from that screen would be written against the wrong date.
   */
  const reqRef = useRef(0);

  const load = useCallback(async (day: string) => {
    const token = ++reqRef.current;
    try {
      setError(null);
      const res = await adminApi.dailyAttendance(day);
      if (token !== reqRef.current) return;
      setData(res);
    } catch (e) {
      if (token !== reqRef.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load the day's attendance.");
    } finally {
      if (token === reqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [load, date]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(date);
  }, [load, date]);

  const today = isoDay(new Date());
  const atToday = date >= today;

  function go(days: number) {
    const next = shiftDay(date, days);
    if (next > today) return; // the future cannot be marked
    setLoading(true);
    setData(null);
    setDate(next);
  }

  const counts = useMemo(() => {
    const list = data?.employees ?? [];
    return {
      all: list.length,
      not_marked: list.filter((e) => e.status === "not_marked").length,
      present: list.filter((e) => e.status === "present").length,
      late: list.filter((e) => e.status === "late").length,
      absent: list.filter((e) => e.status === "absent").length,
      unpaid_holiday: list.filter((e) => e.status === "unpaid_holiday").length,
    };
  }, [data]);

  const chips: Chip[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "not_marked", label: "Not marked", count: counts.not_marked },
    { key: "present", label: "Present", count: counts.present },
    { key: "late", label: "Late", count: counts.late },
    { key: "absent", label: "Absent", count: counts.absent },
    { key: "unpaid_holiday", label: "Unpaid", count: counts.unpaid_holiday },
  ].filter((c) => c.key === "all" || c.key === filter || (c.count ?? 0) > 0);

  const visible = useMemo(() => {
    const list = data?.employees ?? [];
    const q = query.trim().toLowerCase();
    return list.filter(
      (e) =>
        (filter === "all" || e.status === filter) &&
        (!q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)),
    );
  }, [data, filter, query]);

  async function act(fn: () => Promise<unknown>, key: string, failure: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load(date);
      setSelected(null);
      setBulkOpen(false);
    } catch (e) {
      // The sheet stays open on failure: its scrim covers the list, so an error
      // rendered behind it would be invisible exactly when it matters.
      setError(e instanceof ApiError ? e.message : failure);
    } finally {
      setBusy(null);
    }
  }

  const summary = data?.summary;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="Attendance"
        subtitle={data ? `${summary?.total ?? 0} employees` : "Loading…"}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/(admin)"))}
        right={
          <IconButton
            name="ellipsis-horizontal"
            onPress={() => setBulkOpen(true)}
            accessibilityLabel="Bulk actions"
          />
        }
      />

      <View style={styles.controls}>
        <View style={styles.dateBar}>
          <IconButton name="chevron-back" onPress={() => go(-1)} accessibilityLabel="Previous day" />
          <Text style={styles.dateText}>{prettyDay(date)}</Text>
          <IconButton
            name="chevron-forward"
            onPress={() => go(1)}
            disabled={atToday}
            accessibilityLabel="Next day"
          />
        </View>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search name or ID" />
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

        {data?.isHoliday ? (
          <Notice tone="warn">
            {`This day is marked as a holiday${data.holidayType ? ` · ${data.holidayType}` : ""}.`}
          </Notice>
        ) : null}

        {summary ? (
          <StatStrip
            stats={[
              { label: "Employees", value: summary.total },
              { label: "Checked in", value: summary.checkedIn, tone: colors.ok },
              { label: "Absent", value: summary.absent, tone: colors.danger },
            ]}
          />
        ) : null}

        {loading && !data ? <Loading /> : null}

        {visible.map((emp) => {
          const t = tone(emp.status);
          return (
            <Row
              key={emp.id}
              left={<Avatar name={emp.name} />}
              title={emp.name}
              subtitle={
                emp.punchIn
                  ? `${formatTime(emp.punchIn.time)} – ${emp.punchOut ? formatTime(emp.punchOut.time) : "…"}`
                  : "No punch recorded"
              }
              meta={
                emp.durationMinutes
                  ? `${formatDuration(emp.durationMinutes)}${emp.source === "admin" ? " · marked by admin" : ""}`
                  : emp.source === "admin"
                    ? "Marked by admin"
                    : undefined
              }
              right={<StatusPill label={STATUS_LABEL[emp.status]} fg={t.fg} bg={t.bg} />}
              onPress={() => setSelected(emp)}
            />
          );
        })}

        {!loading && !error && !visible.length ? (
          <EmptyState
            icon="people-outline"
            title={query || filter !== "all" ? "No one matches" : "No employees"}
            body={query || filter !== "all" ? "Try a different search or filter." : undefined}
          />
        ) : null}
      </ScrollView>

      {/* Per-employee sheet: detail plus the marking actions. */}
      <Sheet
        visible={!!selected}
        title={selected?.name ?? ""}
        onClose={() => (busy ? null : setSelected(null))}
      >
        {selected ? (
          <>
            {error ? <Notice>{error}</Notice> : null}
            <View style={styles.sheetCard}>
              <DetailRow label="Employee ID" value={selected.id} />
              <DetailRow label="Status" value={STATUS_LABEL[selected.status]} />
              <DetailRow label="Shift starts" value={selected.workStartTime} />
              <DetailRow
                label="Punch in"
                value={selected.punchIn ? formatTime(selected.punchIn.time) : "—"}
              />
              <DetailRow
                label="Punch out"
                value={selected.punchOut ? formatTime(selected.punchOut.time) : "—"}
              />
              <DetailRow
                label="Worked"
                value={selected.durationMinutes ? formatDuration(selected.durationMinutes) : "—"}
              />
              {selected.punchIn?.office ? (
                <DetailRow label="Office" value={selected.punchIn.office} />
              ) : null}
            </View>

            {selected.punchIn?.photoKey || selected.punchOut?.photoKey ? (
              <View style={styles.thumbRow}>
                {selected.punchIn?.photoKey ? (
                  <PunchThumb
                    photoKey={selected.punchIn.photoKey}
                    label="IN"
                    onPress={() => setPhotoKey(selected.punchIn!.photoKey)}
                  />
                ) : null}
                {selected.punchOut?.photoKey ? (
                  <PunchThumb
                    photoKey={selected.punchOut.photoKey}
                    label="OUT"
                    onPress={() => setPhotoKey(selected.punchOut!.photoKey)}
                  />
                ) : null}
              </View>
            ) : null}

            {selected.source === "admin" ? (
              <SheetAction
                icon="arrow-undo-outline"
                label="Undo admin mark"
                tone={colors.danger}
                busy={busy === "undo"}
                disabled={!!busy}
                onPress={() =>
                  act(
                    () => adminApi.undoMark({ employeeId: selected.id, date }),
                    "undo",
                    `Couldn't undo ${selected.name}.`,
                  )
                }
              />
            ) : (
              <>
                <SheetAction
                  icon="checkmark-circle-outline"
                  label="Mark present"
                  tone={colors.ok}
                  busy={busy === "present"}
                disabled={!!busy}
                  onPress={() =>
                    act(
                      () =>
                        adminApi.markAttendance({ employeeId: selected.id, date, action: "present" }),
                      "present",
                      `Couldn't mark ${selected.name}.`,
                    )
                  }
                />
                <SheetAction
                  icon="close-circle-outline"
                  label="Mark absent"
                  tone={colors.danger}
                  busy={busy === "absent"}
                disabled={!!busy}
                  onPress={() =>
                    act(
                      () =>
                        adminApi.markAttendance({ employeeId: selected.id, date, action: "absent" }),
                      "absent",
                      `Couldn't mark ${selected.name}.`,
                    )
                  }
                />
                <SheetAction
                  icon="calendar-outline"
                  label="Mark unpaid holiday"
                  tone={colors.warn}
                  busy={busy === "unpaid_holiday"}
                  onPress={() =>
                    act(
                      () =>
                        adminApi.markAttendance({
                          employeeId: selected.id,
                          date,
                          action: "unpaid_holiday",
                        }),
                      "unpaid_holiday",
                      `Couldn't mark ${selected.name}.`,
                    )
                  }
                />
              </>
            )}
          </>
        ) : null}
      </Sheet>

      {/* Whole-day actions. The server only accepts these two for mark-all. */}
      <Sheet
        visible={bulkOpen}
        title={`Everyone · ${prettyDay(date)}`}
        onClose={() => (busy ? null : setBulkOpen(false))}
      >
        {error ? <Notice>{error}</Notice> : null}
        <View style={styles.sheetCard}>
          <Text style={styles.sheetNote}>
            <Ionicons name="warning-outline" size={14} color={colors.warn} /> This writes attendance
            for every employee on this day.
          </Text>
        </View>
        <SheetAction
          icon="people-outline"
          label="Mark everyone present"
          tone={colors.ok}
          busy={busy === "all-present"}
                disabled={!!busy}
          onPress={() =>
            act(
              () => adminApi.markAll({ date, action: "present" }),
              "all-present",
              "Couldn't mark everyone present.",
            )
          }
        />
        <SheetAction
          icon="calendar-outline"
          label="Mark day as unpaid holiday"
          tone={colors.warn}
          busy={busy === "all-holiday"}
                disabled={!!busy}
          onPress={() =>
            act(
              () => adminApi.markAll({ date, action: "unpaid_holiday" }),
              "all-holiday",
              "Couldn't mark the holiday.",
            )
          }
        />
      </Sheet>

      <PhotoViewer photoKey={photoKey} onClose={() => setPhotoKey(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  controls: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  dateText: { ...type.heading, color: colors.ink },
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
  sheetNote: { ...type.small, color: colors.inkSoft, lineHeight: 19 },
  thumbRow: { flexDirection: "row", gap: spacing.md },
});
