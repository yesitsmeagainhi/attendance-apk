import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import {
  api,
  ApiError,
  LeaveRequest,
  MissPunchRequest,
  RequestStatus,
} from "../../src/api/client";
import { Button, Card, Field, Label, Muted, Notice, Pill, Title } from "../../src/components/ui";
import { colors, radius, spacing, type } from "../../src/theme";
import { s } from "../../src/lib/responsive";
import { formatDate } from "../../src/lib/punch";

type Tab = "leave" | "misspunch";
const LEAVE_TYPES = ["sick", "casual", "earned"] as const;

/** Leave and miss-punch both follow the same raise-then-admin-approves shape. */
export default function RequestsScreen() {
  const [tab, setTab] = useState<Tab>("leave");
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [missPunches, setMissPunches] = useState<MissPunchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
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
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
      >
        <Title>Requests</Title>

        <View style={styles.tabs}>
          <TabButton label="Leave" active={tab === "leave"} onPress={() => { setTab("leave"); setComposing(false); }} />
          <TabButton label="Miss punch" active={tab === "misspunch"} onPress={() => { setTab("misspunch"); setComposing(false); }} />
        </View>

        {error ? <Notice>{error}</Notice> : null}

        {composing ? (
          tab === "leave" ? (
            <LeaveForm
              onDone={() => {
                setComposing(false);
                load();
              }}
              onCancel={() => setComposing(false)}
            />
          ) : (
            <MissPunchForm
              onDone={() => {
                setComposing(false);
                load();
              }}
              onCancel={() => setComposing(false)}
            />
          )
        ) : (
          <Button
            label={tab === "leave" ? "Apply for leave" : "Report a missed punch"}
            onPress={() => setComposing(true)}
          />
        )}

        {tab === "leave" ? (
          leaves.length ? (
            leaves.map((r) => (
              <RequestRow
                key={r.id}
                title={`${cap(r.leaveType)} leave`}
                when={
                  r.fromDate === r.toDate
                    ? formatDate(r.fromDate)
                    : `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}`
                }
                reason={r.reason}
                status={r.status}
                note={r.adminNote}
              />
            ))
          ) : loading ? null : (
            <Muted>No leave requests yet.</Muted>
          )
        ) : missPunches.length ? (
          missPunches.map((r) => (
            <RequestRow
              key={r.id}
              title={`Missed punch ${r.punchType}`}
              when={`${formatDate(r.date)} at ${r.requestedTime}`}
              reason={r.reason}
              status={r.status}
              note={r.adminNote}
            />
          ))
        ) : loading ? null : (
          <Muted>No miss-punch requests yet.</Muted>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LeaveForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [leaveType, setLeaveType] = useState<(typeof LEAVE_TYPES)[number]>("casual");
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("Add a short reason so your admin can review it.");
      return;
    }
    setBusy(true);
    try {
      await api.createLeave({ leaveType, fromDate, toDate, reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't submit the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Label>Leave type</Label>
      <View style={styles.chips}>
        {LEAVE_TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setLeaveType(t)}
            accessibilityRole="radio"
            accessibilityState={{ selected: leaveType === t }}
            style={[styles.chip, leaveType === t && styles.chipOn]}
          >
            <Text style={[styles.chipText, leaveType === t && styles.chipTextOn]}>{cap(t)}</Text>
          </Pressable>
        ))}
      </View>

      <Field label="From (YYYY-MM-DD)" value={fromDate} onChangeText={setFromDate} placeholder="2026-08-25" />
      <Field label="To (YYYY-MM-DD)" value={toDate} onChangeText={setToDate} placeholder="2026-08-26" />
      <Field
        label="Reason"
        value={reason}
        onChangeText={setReason}
        placeholder="Fever, advised rest"
        multiline
      />

      {error ? <Notice>{error}</Notice> : null}
      <Button label="Submit request" onPress={submit} busy={busy} />
      <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
    </Card>
  );
}

function MissPunchForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [date, setDate] = useState(today());
  const [punchType, setPunchType] = useState<"IN" | "OUT">("OUT");
  const [requestedTime, setRequestedTime] = useState("18:30");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    // The server enforces both of these; checking here avoids a pointless round trip.
    if (reason.trim().length < 5) {
      setError("The reason needs at least 5 characters.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(requestedTime)) {
      setError("Time must look like 18:30.");
      return;
    }
    setBusy(true);
    try {
      await api.createMissPunch({ date, punchType, requestedTime, reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't submit the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Label>Which punch</Label>
      <View style={styles.chips}>
        {(["IN", "OUT"] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setPunchType(t)}
            accessibilityRole="radio"
            accessibilityState={{ selected: punchType === t }}
            style={[styles.chip, punchType === t && styles.chipOn]}
          >
            <Text style={[styles.chipText, punchType === t && styles.chipTextOn]}>
              Punch {t.toLowerCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} hint="Cannot be in the future." />
      <Field label="Time (HH:MM)" value={requestedTime} onChangeText={setRequestedTime} placeholder="18:30" />
      <Field
        label="Reason"
        value={reason}
        onChangeText={setReason}
        placeholder="Phone battery died before punch out"
        multiline
      />

      {error ? <Notice>{error}</Notice> : null}
      <Button label="Submit request" onPress={submit} busy={busy} />
      <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
    </Card>
  );
}

function RequestRow({
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
  const palette =
    status === "approved"
      ? { fg: colors.ok, bg: colors.okTint }
      : status === "rejected"
        ? { fg: colors.danger, bg: colors.dangerTint }
        : { fg: colors.warn, bg: colors.warnTint };

  return (
    <View style={styles.reqRow}>
      <View style={styles.reqHead}>
        <Text style={styles.reqTitle}>{title}</Text>
        <Pill text={status} fg={palette.fg} bg={palette.bg} />
      </View>
      <Text style={styles.reqWhen}>{when}</Text>
      <Text style={styles.reqReason}>{reason}</Text>
      {note ? <Text style={styles.reqNote}>Admin: {note}</Text> : null}
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tab, active && styles.tabOn]}
    >
      <Text style={[styles.tabText, active && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

const cap = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const today = () => new Date().toISOString().slice(0, 10);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: {
    flex: 1,
    paddingVertical: s(10),
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    alignItems: "center",
  },
  tabOn: { backgroundColor: colors.brandTint, borderColor: colors.brandBorder },
  tabText: { ...type.small, color: colors.muted, fontWeight: "600" },
  tabTextOn: { color: colors.brand },
  chips: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: s(9),
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { ...type.small, color: colors.inkSoft, fontWeight: "600" },
  chipTextOn: { color: colors.white },
  reqRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: s(5),
  },
  reqHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  reqTitle: { ...type.heading, color: colors.ink, flexShrink: 1 },
  reqWhen: { ...type.small, color: colors.brand, fontWeight: "600" },
  reqReason: { ...type.small, color: colors.inkSoft, lineHeight: s(19) },
  reqNote: { ...type.small, color: colors.muted, fontStyle: "italic" },
});
