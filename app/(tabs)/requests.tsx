import React, { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import {
  api,
  ApiError,
  LeaveRequest,
  MissPunchRequest,
  RequestStatus,
} from "../../src/api/client";
import { Button, Notice } from "../../src/components/ui";
import {
  EmptyState,
  FormField,
  FormSelect,
  IconButton,
  Loading,
  Row,
  ScreenHeader,
  Segmented,
  Sheet,
  StatStrip,
  StatusPill,
} from "../../src/components/adminui";
import { NotificationBell } from "../../src/components/NotificationBell";
import { colors, radius, spacing, type } from "../../src/theme";
import { formatDate } from "../../src/lib/punch";

type Tab = "leave" | "misspunch";

const LEAVE_TYPES = ["sick", "casual", "earned"] as const;
type LeaveType = (typeof LEAVE_TYPES)[number];
type PunchType = "IN" | "OUT";

// FormSelect and Segmented hand back a plain string, so both unions are
// narrowed here rather than asserted — a typo in an option key then falls
// through as a no-op instead of posting a value the server would reject.
const isLeaveType = (key: string): key is LeaveType =>
  (LEAVE_TYPES as readonly string[]).includes(key);
const isPunchType = (key: string): key is PunchType => key === "IN" || key === "OUT";
const isTab = (key: string): key is Tab => key === "leave" || key === "misspunch";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Unchanged from the first cut — the server stores the date it is handed. */
const today = () => new Date().toISOString().slice(0, 10);

function statusPalette(status: RequestStatus): { fg: string; bg: string } {
  if (status === "approved") return { fg: colors.ok, bg: colors.okTint };
  if (status === "rejected") return { fg: colors.danger, bg: colors.dangerTint };
  return { fg: colors.warn, bg: colors.warnTint };
}

function leaveWhen(r: LeaveRequest): string {
  return r.fromDate === r.toDate
    ? formatDate(r.fromDate)
    : `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}`;
}

/**
 * The employee side of the raise-then-admin-approves flow.
 *
 * Leave and miss-punch are two endpoints but one job, so they share a screen
 * behind a segmented control carrying pending counts — the same shape as the
 * admin's approvals screen, read from the other side.
 *
 * The compose form used to expand inline above the list, which pushed the
 * history off-screen the moment it opened and left the apply button and the
 * list's own rows competing for one column. It lives in a sheet now: the list
 * stays put, and the + in the header is the only way in.
 */
export default function RequestsScreen() {
  const [tab, setTab] = useState<Tab>("leave");
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [missPunches, setMissPunches] = useState<MissPunchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which compose sheet is up, if any. Only ever one, so the two never stack
  // as nested Modals.
  const [sheet, setSheet] = useState<Tab | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [punchDate, setPunchDate] = useState(today());
  const [punchType, setPunchType] = useState<PunchType>("OUT");
  const [requestedTime, setRequestedTime] = useState("18:30");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      // Both lists load together so the segment labels can carry live counts.
      const [l, m] = await Promise.all([api.leaves(), api.missPunches()]);
      setLeaves(l.requests);
      setMissPunches(m.requests);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Pull-to-refresh drives its own flag. Wired to `loading` it showed no
   * spinner at all, since `load` only ever lowers that flag and never raises
   * it again after the first fetch.
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
    const tally = (list: Array<{ status: RequestStatus }>) => ({
      total: list.length,
      pending: list.filter((r) => r.status === "pending").length,
      approved: list.filter((r) => r.status === "approved").length,
      rejected: list.filter((r) => r.status === "rejected").length,
    });
    return { leave: tally(leaves), miss: tally(missPunches) };
  }, [leaves, missPunches]);

  const pendingAll = counts.leave.pending + counts.miss.pending;
  const active = tab === "leave" ? counts.leave : counts.miss;

  /** Fresh fields every time, so a half-typed reason never reappears days later. */
  function openCompose() {
    setFormError(null);
    setReason("");
    if (tab === "leave") {
      setLeaveType("casual");
      setFromDate(today());
      setToDate(today());
    } else {
      setPunchDate(today());
      setPunchType("OUT");
      setRequestedTime("18:30");
    }
    setSheet(tab);
  }

  /** Never mid-submit: the request is already in flight and the sheet holds the error. */
  function closeSheet() {
    if (busy) return;
    setSheet(null);
    setFormError(null);
  }

  async function submitLeave() {
    setFormError(null);
    if (!reason.trim()) {
      setFormError("Add a short reason so your admin can review it.");
      return;
    }
    let sent = false;
    setBusy(true);
    try {
      await api.createLeave({ leaveType, fromDate, toDate, reason: reason.trim() });
      sent = true;
    } catch (e) {
      // Stays open on failure, with the typed reason intact to retry.
      setFormError(e instanceof ApiError ? e.message : "Couldn't submit the request.");
    } finally {
      setBusy(false);
    }
    // Lowered before the reload, never held across it. `busy` also gates
    // closeSheet, so a compose sheet re-opened while the list was still
    // refetching used to come up with a dead spinner for a submit button and
    // refuse to close — forever, if that refetch never settled.
    if (sent) {
      setSheet(null);
      void load();
    }
  }

  async function submitMissPunch() {
    setFormError(null);
    // The server enforces both of these; checking here avoids a pointless round trip.
    if (reason.trim().length < 5) {
      setFormError("The reason needs at least 5 characters.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(requestedTime)) {
      setFormError("Time must look like 18:30.");
      return;
    }
    let sent = false;
    setBusy(true);
    try {
      await api.createMissPunch({
        date: punchDate,
        punchType,
        requestedTime,
        reason: reason.trim(),
      });
      sent = true;
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't submit the request.");
    } finally {
      setBusy(false);
    }
    if (sent) {
      setSheet(null);
      void load();
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="My requests"
        subtitle={loading ? "Loading…" : pendingAll ? `${pendingAll} pending` : "Nothing pending"}
        right={
          <View style={styles.headerActions}>
            <NotificationBell />
            <IconButton
              name="add"
              onPress={openCompose}
              accessibilityLabel={tab === "leave" ? "Apply for leave" : "Report a missed punch"}
            />
          </View>
        }
      />

      <View style={styles.controls}>
        <Segmented
          options={[
            { key: "leave", label: "Leave", count: counts.leave.pending || undefined },
            { key: "misspunch", label: "Miss-punch", count: counts.miss.pending || undefined },
          ]}
          active={tab}
          onChange={(key) => {
            if (isTab(key)) setTab(key);
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        {active.total ? (
          <StatStrip
            stats={[
              { label: "Pending", value: active.pending, tone: colors.warn },
              { label: "Approved", value: active.approved, tone: colors.ok },
              { label: "Rejected", value: active.rejected, tone: colors.danger },
            ]}
          />
        ) : null}

        {loading ? <Loading /> : null}

        {!loading && tab === "leave"
          ? leaves.map((r) => (
              <RequestItem
                key={r.id}
                title={`${cap(r.leaveType)} leave`}
                when={leaveWhen(r)}
                reason={r.reason}
                status={r.status}
                note={r.adminNote}
              />
            ))
          : null}

        {!loading && tab === "misspunch"
          ? missPunches.map((r) => (
              <RequestItem
                key={r.id}
                title={`Missed punch ${r.punchType === "IN" ? "in" : "out"}`}
                when={`${formatDate(r.date)} at ${r.requestedTime}`}
                reason={r.reason}
                status={r.status}
                note={r.adminNote}
              />
            ))
          : null}

        {/* Never over a failed load: "No leave requests yet. Tap + to apply."
            reads as a fact about the server, and an employee who believes it
            after their request quietly failed to load applies for the same
            leave twice. On error the notice above stands alone. */}
        {!loading && !error && !active.total ? (
          tab === "leave" ? (
            <EmptyState
              icon="calendar-outline"
              title="No leave requests yet"
              body="Tap + to apply. Your admin sees it straight away."
            />
          ) : (
            <EmptyState
              icon="alarm-outline"
              title="No miss-punch requests yet"
              body="Tap + if you forgot to punch in or out on a working day."
            />
          )
        ) : null}
      </ScrollView>

      {/* Body rendered only while open, so a closed sheet costs nothing.
          openCompose is what actually clears the fields — they live up here. */}
      <Sheet visible={sheet === "leave"} title="Apply for leave" onClose={closeSheet}>
        {sheet === "leave" ? (
          <>
            {formError ? <Notice>{formError}</Notice> : null}

            <View style={styles.sheetCard}>
              <FormSelect
                label="Leave type"
                options={LEAVE_TYPES.map((t) => ({ key: t, label: cap(t) }))}
                value={leaveType}
                onChange={(key) => {
                  if (isLeaveType(key)) setLeaveType(key);
                }}
                required
              />
              <FormField
                label="From"
                hint="YYYY-MM-DD"
                value={fromDate}
                onChangeText={setFromDate}
                placeholder="2026-08-25"
                maxLength={10}
                autoCapitalize="none"
                autoCorrect={false}
                required
              />
              <FormField
                label="To"
                hint="Same as the from date for a single day."
                value={toDate}
                onChangeText={setToDate}
                placeholder="2026-08-26"
                maxLength={10}
                autoCapitalize="none"
                autoCorrect={false}
                required
              />
              <FormField
                label="Reason"
                value={reason}
                onChangeText={setReason}
                placeholder="Fever, advised rest"
                multiline
                required
              />
            </View>

            <Button label="Submit request" onPress={submitLeave} busy={busy} />
          </>
        ) : null}
      </Sheet>

      <Sheet visible={sheet === "misspunch"} title="Report a missed punch" onClose={closeSheet}>
        {sheet === "misspunch" ? (
          <>
            {formError ? <Notice>{formError}</Notice> : null}

            <View style={styles.sheetCard}>
              <FormSelect
                label="Which punch"
                options={[
                  { key: "IN", label: "Punch in" },
                  { key: "OUT", label: "Punch out" },
                ]}
                value={punchType}
                onChange={(key) => {
                  if (isPunchType(key)) setPunchType(key);
                }}
                required
              />
              <FormField
                label="Date"
                hint="YYYY-MM-DD. Cannot be in the future."
                value={punchDate}
                onChangeText={setPunchDate}
                placeholder="2026-08-25"
                maxLength={10}
                autoCapitalize="none"
                autoCorrect={false}
                required
              />
              <FormField
                label="Time"
                hint="24-hour clock, like 18:30."
                value={requestedTime}
                onChangeText={setRequestedTime}
                placeholder="18:30"
                maxLength={5}
                autoCapitalize="none"
                autoCorrect={false}
                required
              />
              <FormField
                label="Reason"
                hint="At least 5 characters."
                value={reason}
                onChangeText={setReason}
                placeholder="Phone battery died before punch out"
                multiline
                required
              />
            </View>

            <Button label="Submit request" onPress={submitMissPunch} busy={busy} />
          </>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

/**
 * One request: the quiet row, plus the reason and the admin's note underneath.
 * All three share one card so a rejected request reads as a single object — the
 * verdict and the reason for it — not two stacked cards.
 *
 * The reason sits below the Row rather than in its `meta` slot: Row clamps
 * every line to one, and the reason is the whole substance of the record.
 * "Sister's wedding in Nagpur, travelling the 21st to the 24th" was arriving as
 * "Sister's wedding in Nagpur, travelling…" with nowhere to tap for the rest.
 */
function RequestItem({
  title,
  when,
  reason,
  status,
  note,
}: {
  title: string;
  when: string;
  reason: string;
  status: RequestStatus;
  note: string | null;
}) {
  const palette = statusPalette(status);
  return (
    <View style={styles.item}>
      <Row
        title={title}
        subtitle={when}
        right={<StatusPill label={cap(status)} fg={palette.fg} bg={palette.bg} />}
      />
      {reason ? <Text style={styles.reason}>{reason}</Text> : null}
      {note ? (
        <View style={styles.note}>
          <Text style={styles.noteText}>
            <Text style={styles.noteLabel}>Admin: </Text>
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  controls: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },

  // Same fill as Row, so the row's own corners vanish into it and the note
  // below reads as part of the same card.
  item: { backgroundColor: colors.card, borderRadius: radius.md, overflow: "hidden" },
  reason: {
    ...type.small,
    color: colors.inkSoft,
    lineHeight: 19,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  note: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  noteText: { ...type.small, color: colors.inkSoft, lineHeight: 19 },
  noteLabel: { color: colors.muted, fontWeight: "600" },

  sheetCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
