import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  api,
  ApiError,
  LeaveRequest,
  MissPunchRequest,
  RequestStatus,
} from "../../src/api/client";
import { Button, Card, Label, Muted, Notice, Pill, Title } from "../../src/components/ui";
import { colors, radius, spacing, type } from "../../src/theme";
import { s } from "../../src/lib/responsive";
import { formatDate } from "../../src/lib/punch";

type Tab = "leave" | "misspunch";
/** Pre-filled miss-punch, from the "forgot to punch in?" reminder or a History row */
type MissPunchPrefill = { punchType: "IN" | "OUT"; date: string; time?: string; then?: "punch" };
const LEAVE_TYPES = ["sick", "casual", "earned"] as const;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function RequestsScreen() {
  const [tab, setTab] = useState<Tab>("leave");
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [missPunches, setMissPunches] = useState<MissPunchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [prefill, setPrefill] = useState<MissPunchPrefill | null>(null);
  const router = useRouter();
  const params = useLocalSearchParams<{ compose?: string; punchType?: string; date?: string; time?: string; then?: string }>();

  // Opened with a pre-filled miss punch: switch to that form, then clear the params
  useEffect(() => {
    if (params.compose !== "misspunch" || !params.date) return;
    setTab("misspunch");
    setPrefill({
      punchType: params.punchType === "IN" ? "IN" : "OUT",
      date: params.date,
      time: params.time,
      then: params.then === "punch" ? "punch" : undefined,
    });
    setComposing(true);
    router.setParams({ compose: undefined, punchType: undefined, date: undefined, time: undefined, then: undefined });
  }, [params.compose, params.punchType, params.date, params.time, params.then, router]);

  /** Withdraw a leave request that hasn't been reviewed yet. */
  function withdrawLeave(id: string) {
    Alert.alert("Withdraw leave request?", "Your admin will no longer see this request.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Withdraw",
        style: "destructive",
        onPress: async () => {
          try {
            setError(null);
            await api.withdrawLeave(id);
            load();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Couldn't withdraw the request.");
          }
        },
      },
    ]);
  }

  /** After a "forgot to punch in" request: go straight on to the punch (now a punch-out). */
  async function continueToPunch() {
    try {
      const st = await api.status();
      if (st.nextPunchType && (st.nextPunchType === "IN" ? st.canPunchIn : st.canPunchOut)) {
        router.push({ pathname: "/punch", params: { type: st.nextPunchType } });
        return;
      }
    } catch {
      // fall back to the Today screen
    }
    router.navigate("/");
  }

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
    useCallback(() => { load(); }, [load]),
  );

  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  /**
   * Lift a form field so it sits just above the keyboard, and no higher.
   *
   * Everything is measured on the device at the moment the keyboard is up:
   * the field, the scroll area's visible bottom (already shortened by the
   * KeyboardAvoidingView padding) and, when the keyboard event gives it, the
   * keyboard's real top edge. Whichever edge is higher is the limit, so it
   * fits any phone size, keyboard height, gesture or 3-button navigation.
   * The view only scrolls by the amount the field is hidden; a field that is
   * already fully visible doesn't move.
   */
  const revealField = useCallback((field: View | null) => {
    if (!field) return;
    let done = false;
    const run = (keyboardTop?: number) => {
      if (done) return;
      done = true;
      sub.remove();
      clearTimeout(fallback);
      const scroll = scrollRef.current;
      if (!scroll) return;
      field.measureInWindow((_fx, fy, _fw, fh) => {
        (scroll as unknown as View).measureInWindow((_sx, sy, _sw, sh) => {
          let visibleBottom = sy + sh;
          if (keyboardTop && keyboardTop > sy) visibleBottom = Math.min(visibleBottom, keyboardTop);
          const gap = spacing.md; // breathing room between the box and the keyboard
          const hiddenBy = fy + fh + gap - visibleBottom;
          if (hiddenBy <= 0) return; // already visible
          // Never push the field's top out of view (very small screens)
          const maxLift = Math.max(0, fy - sy - gap);
          const lift = Math.min(hiddenBy, maxLift || hiddenBy);
          scroll.scrollTo({ y: scrollY.current + lift, animated: true });
        });
      });
    };
    const sub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        const top = e?.endCoordinates?.screenY;
        // Let the padding for the keyboard apply before measuring
        requestAnimationFrame(() => setTimeout(() => run(top), Platform.OS === "ios" ? 250 : 30));
      },
    );
    // Keyboard already open (moving between fields): no show event will come
    const fallback = setTimeout(() => run(), 450);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Android is edge-to-edge, so the window no longer resizes for the
          keyboard on its own: pad the screen instead, on both platforms. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        ref={scrollRef}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
      >
        <Title>Requests</Title>

        <View style={styles.tabs}>
          <TabButton label="Leave" active={tab === "leave"} onPress={() => { setTab("leave"); setComposing(false); setPrefill(null); }} />
          <TabButton label="Miss punch" active={tab === "misspunch"} onPress={() => { setTab("misspunch"); setComposing(false); setPrefill(null); }} />
        </View>

        {error ? <Notice>{error}</Notice> : null}

        {composing ? (
          tab === "leave" ? (
            <LeaveForm onReveal={revealField} onDone={() => { setComposing(false); load(); }} onCancel={() => setComposing(false)} />
          ) : (
            <MissPunchForm
              key={prefill ? `${prefill.date}-${prefill.punchType}-${prefill.time ?? ""}` : "blank"}
              prefill={prefill}
              onReveal={revealField}
              onDone={() => {
                const then = prefill?.then;
                setComposing(false);
                setPrefill(null);
                load();
                if (then === "punch") continueToPunch();
              }}
              onCancel={() => { setComposing(false); setPrefill(null); }}
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
                when={r.fromDate === r.toDate ? formatDate(r.fromDate) : `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}`}
                reason={r.reason}
                status={r.status}
                note={r.adminNote}
                onWithdraw={r.status === "pending" ? () => withdrawLeave(r.id) : undefined}
              />
            ))
          ) : loading ? null : <Muted>No leave requests yet.</Muted>
        ) : missPunches.length ? (
          missPunches.map((r) => (
            <RequestRow
              key={r.id}
              title={`Missed punch ${r.punchType}`}
              when={`${formatDate(r.date)} at ${formatTime12(r.requestedTime)}`}
              reason={r.reason}
              status={r.status}
              note={r.adminNote}
            />
          ))
        ) : loading ? null : <Muted>No miss-punch requests yet.</Muted>}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Leave form ────────────────────────────────────────────────────────────────

function LeaveForm({ onDone, onCancel, onReveal }: { onDone: () => void; onCancel: () => void; onReveal: (v: View | null) => void }) {
  const reasonRef = useRef<View>(null);
  const [leaveType, setLeaveType] = useState<(typeof LEAVE_TYPES)[number]>("casual");
  const [fromDate, setFromDate] = useState(todayDate());
  const [toDate, setToDate] = useState(todayDate());
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
      await api.createLeave({ leaveType, fromDate: toYMD(fromDate), toDate: toYMD(toDate), reason: reason.trim() });
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

      <DateField
        label="From"
        value={fromDate}
        onChange={(d) => { setFromDate(d); if (d > toDate) setToDate(d); }}
      />
      <DateField label="To" value={toDate} minimumDate={fromDate} onChange={setToDate} />

      <View ref={reasonRef} collapsable={false} style={styles.fieldWrap}>
        <Label>Reason</Label>
        <TextInput
          value={reason}
          onChangeText={setReason}
          onFocus={() => onReveal(reasonRef.current)}
          placeholder="Fever, advised rest"
          placeholderTextColor={colors.muted}
          multiline
          style={[styles.input, { minHeight: s(80), textAlignVertical: "top" }]}
        />
      </View>

      {error ? <Notice>{error}</Notice> : null}
      <Button label="Submit request" onPress={submit} busy={busy} />
      <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
    </Card>
  );
}

// ─── Miss-punch form ───────────────────────────────────────────────────────────

function MissPunchForm({ prefill, onDone, onCancel, onReveal }: { prefill?: MissPunchPrefill | null; onDone: () => void; onCancel: () => void; onReveal: (v: View | null) => void }) {
  const reasonRef = useRef<View>(null);
  const [date, setDate] = useState(() => (prefill ? fromYMD(prefill.date) : todayDate()));
  const [punchType, setPunchType] = useState<"IN" | "OUT">(prefill?.punchType ?? "OUT");
  const [time, setTime] = useState(() => {
    const d = new Date();
    const [h, m] = (prefill?.time ?? "18:30").split(":").map(Number);
    d.setHours(isNaN(h) ? 18 : h, isNaN(m) ? 30 : m, 0, 0);
    return d;
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (reason.trim().length < 5) {
      setError("The reason needs at least 5 characters.");
      return;
    }
    setBusy(true);
    try {
      await api.createMissPunch({ date: toYMD(date), punchType, requestedTime: toHHMM(time), reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't submit the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {prefill?.then === "punch" ? (
        <Notice tone="warn">
          Request your missed punch-in. After you submit, the camera opens so your punch now is saved as the punch-out.
        </Notice>
      ) : null}
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
            <Text style={[styles.chipText, punchType === t && styles.chipTextOn]}>Punch {t.toLowerCase()}</Text>
          </Pressable>
        ))}
      </View>

      <DateField label="Date" value={date} maximumDate={todayDate()} onChange={setDate} />
      <TimeField label="Time" value={time} onChange={setTime} />

      <View ref={reasonRef} collapsable={false} style={styles.fieldWrap}>
        <Label>Reason</Label>
        <TextInput
          value={reason}
          onChangeText={setReason}
          onFocus={() => onReveal(reasonRef.current)}
          placeholder="Phone battery died before punch out"
          placeholderTextColor={colors.muted}
          multiline
          style={[styles.input, { minHeight: s(80), textAlignVertical: "top" }]}
        />
      </View>

      {error ? <Notice>{error}</Notice> : null}
      <Button label="Submit request" onPress={submit} busy={busy} />
      <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
    </Card>
  );
}

// ─── Date field + calendar modal ───────────────────────────────────────────────

function DateField({
  label, value, onChange, minimumDate, maximumDate,
}: {
  label: string; value: Date; onChange: (d: Date) => void; minimumDate?: Date; maximumDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Label>{label}</Label>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="calendar-outline" size={s(18)} color={colors.brand} />
        <Text style={styles.pickerValue}>{formatDate(toYMD(value))}</Text>
        <Ionicons name="chevron-down" size={s(16)} color={colors.muted} />
      </Pressable>
      {open ? <CalendarModal
        visible={open}
        value={value}
        onConfirm={(d) => { onChange(d); setOpen(false); }}
        onDismiss={() => setOpen(false)}
        minimumDate={minimumDate}
        maximumDate={maximumDate}
      /> : null}
    </View>
  );
}

// ─── Time field + time modal ───────────────────────────────────────────────────

function TimeField({
  label, value, onChange,
}: {
  label: string; value: Date; onChange: (d: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Label>{label}</Label>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="time-outline" size={s(18)} color={colors.brand} />
        <Text style={styles.pickerValue}>{formatTime12(toHHMM(value))}</Text>
        <Ionicons name="chevron-down" size={s(16)} color={colors.muted} />
      </Pressable>
      {open ? <TimeModal
        visible={open}
        value={value}
        onConfirm={(d) => { onChange(d); setOpen(false); }}
        onDismiss={() => setOpen(false)}
      /> : null}
    </View>
  );
}

// ─── Calendar modal ────────────────────────────────────────────────────────────

function CalendarModal({
  visible, value, onConfirm, onDismiss, minimumDate, maximumDate,
}: {
  visible: boolean; value: Date; onConfirm: (d: Date) => void; onDismiss: () => void;
  minimumDate?: Date; maximumDate?: Date;
}) {
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const todayMidnight = todayDate();
  const selectedMidnight = new Date(value); selectedMidnight.setHours(0, 0, 0, 0);

  function pickDay(day: number) {
    const d = new Date(viewYear, viewMonth, day, 0, 0, 0, 0);
    if (minimumDate && d < minimumDate) return;
    if (maximumDate && d > maximumDate) return;
    onConfirm(d);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={calStyles.overlay} onPress={onDismiss}>
        <View style={calStyles.box}>
          {/* Month navigation */}
          <View style={calStyles.navRow}>
            <Pressable onPress={prevMonth} hitSlop={12} style={calStyles.navBtn}>
              <Ionicons name="chevron-back" size={s(22)} color={colors.brand} />
            </Pressable>
            <Text style={calStyles.monthLabel}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
            <Pressable onPress={nextMonth} hitSlop={12} style={calStyles.navBtn}>
              <Ionicons name="chevron-forward" size={s(22)} color={colors.brand} />
            </Pressable>
          </View>

          {/* Weekday headers */}
          <View style={calStyles.weekRow}>
            {DAY_LABELS.map((d, i) => (
              <Text key={i} style={calStyles.weekLabel}>{d}</Text>
            ))}
          </View>

          {/* Day grid */}
          {rows.map((row, ri) => (
            <View key={ri} style={calStyles.weekRow}>
              {row.map((day, ci) => {
                if (!day) return <View key={ci} style={calStyles.cell} />;
                const cellDate = new Date(viewYear, viewMonth, day, 0, 0, 0, 0);
                const isSelected = cellDate.getTime() === selectedMidnight.getTime();
                const isToday = cellDate.getTime() === todayMidnight.getTime();
                const disabled =
                  (minimumDate != null && cellDate < minimumDate) ||
                  (maximumDate != null && cellDate > maximumDate);
                return (
                  <Pressable
                    key={ci}
                    onPress={() => pickDay(day)}
                    disabled={disabled}
                    style={[calStyles.cell, isSelected && calStyles.cellSelected]}
                  >
                    <Text style={[
                      calStyles.dayText,
                      isToday && !isSelected && calStyles.dayToday,
                      isSelected && calStyles.daySelectedText,
                      disabled && calStyles.dayDisabled,
                    ]}>
                      {day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <Pressable onPress={onDismiss} style={calStyles.cancelRow}>
            <Text style={calStyles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

// ─── Time modal ────────────────────────────────────────────────────────────────

function TimeModal({
  visible, value, onConfirm, onDismiss,
}: {
  visible: boolean; value: Date; onConfirm: (d: Date) => void; onDismiss: () => void;
}) {
  const rawH = value.getHours();
  const [hour12, setHour12] = useState(rawH % 12 || 12);
  const [minute, setMinute] = useState(value.getMinutes());
  const [ampm, setAmpm] = useState<"AM" | "PM">(rawH < 12 ? "AM" : "PM");

  function adjustHour(dir: 1 | -1) {
    setHour12((h) => ((h - 1 + dir + 12) % 12) + 1);
  }
  function adjustMinute(dir: 1 | -1) {
    setMinute((m) => (m + dir * 1 + 60) % 60);
  }

  function confirm() {
    const h24 = ampm === "AM" ? (hour12 === 12 ? 0 : hour12) : (hour12 === 12 ? 12 : hour12 + 12);
    const d = new Date(value);
    d.setHours(h24, minute, 0, 0);
    onConfirm(d);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={calStyles.overlay} onPress={onDismiss}>
        <View style={calStyles.box}>
          <Text style={calStyles.monthLabel}>Select time</Text>

          <View style={timeStyles.clockRow}>
            {/* Hours */}
            <View style={timeStyles.column}>
              <Pressable onPress={() => adjustHour(1)} hitSlop={12}>
                <Ionicons name="chevron-up" size={s(26)} color={colors.brand} />
              </Pressable>
              <Text style={timeStyles.digit}>{String(hour12).padStart(2, "0")}</Text>
              <Pressable onPress={() => adjustHour(-1)} hitSlop={12}>
                <Ionicons name="chevron-down" size={s(26)} color={colors.brand} />
              </Pressable>
            </View>

            <Text style={timeStyles.colon}>:</Text>

            {/* Minutes */}
            <View style={timeStyles.column}>
              <Pressable onPress={() => adjustMinute(1)} hitSlop={12}>
                <Ionicons name="chevron-up" size={s(26)} color={colors.brand} />
              </Pressable>
              <Text style={timeStyles.digit}>{String(minute).padStart(2, "0")}</Text>
              <Pressable onPress={() => adjustMinute(-1)} hitSlop={12}>
                <Ionicons name="chevron-down" size={s(26)} color={colors.brand} />
              </Pressable>
            </View>

            {/* AM / PM */}
            <View style={timeStyles.ampmCol}>
              {(["AM", "PM"] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setAmpm(p)}
                  style={[timeStyles.ampmBtn, ampm === p && timeStyles.ampmBtnOn]}
                >
                  <Text style={[timeStyles.ampmText, ampm === p && timeStyles.ampmTextOn]}>{p}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={timeStyles.actionRow}>
            <Pressable onPress={onDismiss} style={timeStyles.btn}>
              <Text style={timeStyles.btnCancel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={confirm} style={[timeStyles.btn, timeStyles.btnOk]}>
              <Text style={timeStyles.btnOkText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

// ─── Request list row ──────────────────────────────────────────────────────────

function RequestRow({ title, when, reason, status, note, onWithdraw }: {
  title: string; when: string; reason: string; status: RequestStatus; note: string | null;
  /** Shown for pending leave requests */
  onWithdraw?: () => void;
}) {
  const palette =
    status === "approved" ? { fg: colors.ok, bg: colors.okTint } :
      status === "rejected" ? { fg: colors.danger, bg: colors.dangerTint } :
        { fg: colors.warn, bg: colors.warnTint };

  return (
    <View style={styles.reqRow}>
      <View style={styles.reqHead}>
        <Text style={styles.reqTitle}>{title}</Text>
        <Pill text={status} fg={palette.fg} bg={palette.bg} />
      </View>
      <Text style={styles.reqWhen}>{when}</Text>
      <Text style={styles.reqReason}>{reason}</Text>
      {note ? <Text style={styles.reqNote}>Admin: {note}</Text> : null}
      {onWithdraw ? (
        <Pressable
          onPress={onWithdraw}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [styles.withdrawBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.withdrawText}>Withdraw request</Text>
        </Pressable>
      ) : null}
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function todayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fromYMD(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return todayDate();
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

const cap = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },

  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: {
    flex: 1, paddingVertical: s(10), borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.rule, alignItems: "center",
  },
  tabOn: { backgroundColor: colors.brandTint, borderColor: colors.brandBorder },
  tabText: { ...type.small, color: colors.muted, fontWeight: "600" },
  tabTextOn: { color: colors.brand },

  chips: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: spacing.lg, paddingVertical: s(9),
    borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.rule,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { ...type.small, color: colors.inkSoft, fontWeight: "600" },
  chipTextOn: { color: colors.white },

  fieldWrap: { gap: spacing.sm },
  pickerRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 1, borderColor: colors.rule, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: s(14),
    backgroundColor: colors.card,
  },
  pickerValue: { flex: 1, fontSize: s(15), color: colors.ink, fontWeight: "600" },
  input: {
    borderWidth: 1, borderColor: colors.rule, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: s(14),
    fontSize: s(15), color: colors.ink, backgroundColor: colors.card,
  },

  reqRow: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.rule,
    borderRadius: radius.md, padding: spacing.lg, gap: s(5),
  },
  reqHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  reqTitle: { ...type.heading, color: colors.ink, flexShrink: 1 },
  reqWhen: { ...type.small, color: colors.brand, fontWeight: "600" },
  reqReason: { ...type.small, color: colors.inkSoft, lineHeight: s(19) },
  reqNote: { ...type.small, color: colors.muted, fontStyle: "italic" },
  withdrawBtn: {
    alignSelf: "flex-start", marginTop: s(4),
    borderWidth: 1, borderColor: colors.danger, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: s(5),
  },
  withdrawText: { ...type.small, fontSize: s(12), color: colors.danger, fontWeight: "700" },
});

const calStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center", alignItems: "center", padding: spacing.lg,
  },
  box: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    padding: spacing.lg, width: "100%", maxWidth: s(340),
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18, shadowRadius: 20, elevation: 10,
  },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  navBtn: { padding: s(4) },
  monthLabel: { ...type.heading, color: colors.ink, fontWeight: "700" },
  weekRow: { flexDirection: "row", marginBottom: s(2) },
  weekLabel: { flex: 1, textAlign: "center", ...type.small, color: colors.muted, fontWeight: "600", paddingVertical: s(6) },
  cell: { flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: s(22), margin: s(1) },
  cellSelected: { backgroundColor: colors.brand },
  dayText: { ...type.body, color: colors.ink },
  dayToday: { color: colors.accent, fontWeight: "700" },
  daySelectedText: { color: colors.white, fontWeight: "700" },
  dayDisabled: { color: colors.rule },
  cancelRow: { marginTop: spacing.md, alignItems: "center", paddingVertical: s(6) },
  cancelText: { ...type.body, color: colors.muted },
});

const timeStyles = StyleSheet.create({
  clockRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing.xl ?? spacing.lg, marginVertical: spacing.lg,
  },
  column: { alignItems: "center", gap: spacing.sm },
  digit: {
    fontSize: s(48), fontWeight: "700", color: colors.ink,
    fontVariant: ["tabular-nums"], minWidth: s(62), textAlign: "center",
  },
  colon: { fontSize: s(40), fontWeight: "700", color: colors.ink, marginBottom: s(6) },
  ampmCol: { gap: spacing.sm },
  ampmBtn: {
    paddingHorizontal: spacing.md, paddingVertical: s(10),
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.rule,
  },
  ampmBtnOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  ampmText: { ...type.small, color: colors.inkSoft, fontWeight: "600" },
  ampmTextOn: { color: colors.white },
  actionRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  btn: {
    flex: 1, paddingVertical: s(13), alignItems: "center",
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.rule,
  },
  btnOk: { backgroundColor: colors.brand, borderColor: colors.brand },
  btnCancel: { ...type.body, color: colors.muted, fontWeight: "600" },
  btnOkText: { ...type.body, color: colors.white, fontWeight: "700" },
});
