import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, ApiError, HistoryRecord, HistoryResponse } from "../../src/api/client";
import { Card, Label, Muted, Notice, Pill, Title } from "../../src/components/ui";
import { PhotoViewer, PunchThumb } from "../../src/components/PunchPhoto";
import { colors, radius, spacing, statusColors, type } from "../../src/theme";
import { s } from "../../src/lib/responsive";
import { formatDate, formatDuration, formatTime } from "../../src/lib/punch";

type Viewing = { key: string; caption: string } | null;

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const LEGEND: { label: string; color: string }[] = [
  { label: "Present", color: colors.ok },
  { label: "Late / Half", color: colors.warn },
  { label: "Absent", color: colors.danger },
  { label: "Leave / Holiday", color: colors.accent },
  { label: "Off", color: colors.muted },
];

export default function HistoryScreen() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Only the latest request may write state, so a slow response for a month
  // the user already left can't overwrite the month now on screen.
  const reqId = useRef(0);

  // Always ask for a calendar month. Without ?month= the server returns a
  // rolling last-30-days window, which spans two months.
  const load = useCallback(async (m: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.history(m);
      if (id !== reqId.current) return;
      setData(res);
      // Keep the chosen day if it's still in this month's data, else show the newest day
      setSelected((cur) =>
        cur && res.records.some((r) => r.date === cur) ? cur : res.records[0]?.date ?? null,
      );
    } catch (e) {
      if (id === reqId.current) setError(e instanceof ApiError ? e.message : "Couldn't load your history.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(month);
    }, [load, month]),
  );

  const changeMonth = (delta: number) => {
    setData(null);
    setSelected(null);
    setMonth((m) => shiftMonth(m, delta));
  };
  const atCurrent = month >= currentMonth();
  const isFlex = !!data?.isFlexible;

  const byDate = useMemo(() => {
    const map = new Map<string, HistoryRecord>();
    for (const r of data?.records ?? []) map.set(r.date, r);
    return map;
  }, [data]);

  const selectedRecord = selected ? byDate.get(selected) ?? null : null;
  const missedDays = (data?.records ?? []).filter((r) => r.missedPunchIn || r.missedPunchOut);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => load(month)} tintColor={colors.brand} />
        }
      >
        <Title>Your attendance</Title>

        <View style={styles.monthBar}>
          <Pressable
            onPress={() => changeMonth(-1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <Ionicons name="chevron-back" size={22} color={colors.brand} />
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
          <Pressable
            onPress={() => changeMonth(1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            disabled={atCurrent}
          >
            <Ionicons name="chevron-forward" size={22} color={atCurrent ? colors.rule : colors.brand} />
          </Pressable>
        </View>

        {error ? <Notice>{error}</Notice> : null}

        {data ? (
          <View style={styles.statRow}>
            <Stat value={data.presentDays} label="Present" tone={colors.ok} />
            <Stat value={data.lateDays} label="Late" tone={colors.warn} />
            <Stat value={data.halfDays} label="Half" tone={colors.warn} />
            <Stat value={data.absentDays} label="Absent" tone={colors.danger} />
          </View>
        ) : null}

        <Card>
          <CalendarGrid month={month} byDate={byDate} selected={selected} onSelect={setSelected} />
          <View style={styles.legend}>
            {LEGEND.map((l) => (
              <View key={l.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: l.color }]} />
                <Text style={styles.legendText}>{l.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        {selectedRecord ? (
          <DayDetail record={selectedRecord} isFlex={isFlex} onViewPhoto={setViewing} />
        ) : !loading && data ? (
          <Muted>
            {data.records.length ? "Tap a day to see its punches." : "No attendance records for this month."}
          </Muted>
        ) : null}

        {missedDays.length ? (
          <View style={{ gap: spacing.sm }}>
            <Label>Needs attention</Label>
            {missedDays.map((r) => (
              <Pressable
                key={r.date}
                onPress={() => setSelected(r.date)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.attnRow,
                  r.date === selected && styles.attnRowOn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.attnDate}>{formatDate(r.date)}</Text>
                <Text style={styles.missedTag}>
                  {r.missedPunchIn ? "Missed punch-in" : "Missed punch-out"}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <PhotoViewer
        photoKey={viewing?.key ?? null}
        caption={viewing?.caption}
        onClose={() => setViewing(null)}
      />
    </SafeAreaView>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function CalendarGrid({
  month,
  byDate,
  selected,
  onSelect,
}: {
  month: string;
  byDate: Map<string, HistoryRecord>;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  // Monday-first grid
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const today = todayStr();

  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);

  return (
    <View>
      <View style={styles.gridRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((date, i) => {
          if (!date) return <View key={`e${i}`} style={styles.cell} />;
          const rec = byDate.get(date);
          const sc = rec ? statusColors(rec.status) : null;
          const isSel = date === selected;
          const isFuture = date > today;
          const missed = rec?.missedPunchIn || rec?.missedPunchOut;
          return (
            <View key={date} style={styles.cell}>
              <Pressable
                disabled={!rec}
                onPress={() => onSelect(date)}
                accessibilityRole="button"
                accessibilityLabel={`${formatDate(date)}${rec ? `, ${rec.status}` : ""}`}
                accessibilityState={{ selected: isSel, disabled: !rec }}
                style={[
                  styles.dayBtn,
                  sc && { backgroundColor: sc.bg },
                  date === today && styles.dayToday,
                  isSel && styles.daySelected,
                ]}
              >
                <Text
                  style={[
                    styles.dayNum,
                    sc ? { color: sc.fg, fontWeight: "700" } : null,
                    isFuture && { color: colors.rule },
                  ]}
                >
                  {Number(date.slice(8))}
                </Text>
                {missed ? <View style={styles.missedDot} /> : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DayDetail({
  record,
  isFlex,
  onViewPhoto,
}: {
  record: HistoryRecord;
  isFlex: boolean;
  onViewPhoto: (v: Viewing) => void;
}) {
  const router = useRouter();
  const sc = statusColors(record.status);
  // Every punch stays visible; a lone punch-in or punch-out is tagged so it can be fixed
  const missed = record.missedPunchIn ? "IN" : record.missedPunchOut ? "OUT" : null;
  const hasPhotos = !!(record.photoKeyIn || record.photoKeyOut);
  const sessions = record.sessions;
  const showSessions = isFlex && sessions && sessions.length > 0;
  const hasPunches = !!(record.punchInTime || record.punchOutTime);

  return (
    <View style={[styles.detail, { borderLeftColor: sc.fg }]}>
      <View style={styles.detailTop}>
        <Text style={styles.detailDate}>{formatDate(record.date)}</Text>
        <Pill text={record.status} fg={sc.fg} bg={sc.bg} />
      </View>

      {record.holidayName && !hasPunches ? <Text style={styles.detailSub}>{record.holidayName}</Text> : null}

      {hasPunches || record.duration ? (
        <View style={styles.timesRow}>
          <TimeBlock label="IN" value={formatTime(record.punchInTime)} />
          <Ionicons name="arrow-forward" size={16} color={colors.muted} />
          <TimeBlock label="OUT" value={formatTime(record.punchOutTime)} />
          <TimeBlock label="TOTAL" value={formatDuration(record.duration)} align="right" />
        </View>
      ) : null}

      {record.lateByMinutes ? (
        <Text style={styles.detailSub}>Late by {formatDuration(record.lateByMinutes)}</Text>
      ) : null}

      {showSessions ? (
        <View style={styles.sessionsBlock}>
          {sessions.map((ses, i) => (
            <View key={i} style={styles.sessionLine}>
              <Text style={styles.sessionLabel}>S{i + 1}</Text>
              <Text style={styles.sessionTimes}>
                {formatTime(ses.inTime)} — {ses.outTime ? formatTime(ses.outTime) : "ongoing"}
              </Text>
              <Text style={styles.sessionDur}>
                {ses.durationMinutes != null ? formatDuration(ses.durationMinutes) : "—"}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {missed ? (
        <View style={styles.missedRow}>
          <Text style={styles.missedTag}>{missed === "IN" ? "Missed punch-in" : "Missed punch-out"}</Text>
          <Pressable
            onPress={() =>
              router.push({ pathname: "/requests", params: { compose: "misspunch", punchType: missed, date: record.date } })
            }
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.missedBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.missedBtnText}>Request miss punch</Text>
          </Pressable>
        </View>
      ) : null}

      {hasPhotos ? (
        <View style={styles.photos}>
          {record.photoKeyIn ? (
            <PunchThumb
              photoKey={record.photoKeyIn}
              label="IN"
              onPress={() =>
                onViewPhoto({
                  key: record.photoKeyIn!,
                  caption: `Punch in · ${formatDate(record.date)} · ${formatTime(record.punchInTime)}`,
                })
              }
            />
          ) : null}
          {record.photoKeyOut ? (
            <PunchThumb
              photoKey={record.photoKeyOut}
              label="OUT"
              onPress={() =>
                onViewPhoto({
                  key: record.photoKeyOut!,
                  caption: `Punch out · ${formatDate(record.date)} · ${formatTime(record.punchOutTime)}`,
                })
              }
            />
          ) : null}
          {record.office ? <Text style={styles.office}>{record.office}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function TimeBlock({ label, value, align }: { label: string; value: string; align?: "right" }) {
  return (
    <View style={[styles.timeBlock, align === "right" && { flex: 1, alignItems: "flex-end" }]}>
      <Text style={styles.timeLabel}>{label}</Text>
      <Text style={styles.timeValue}>{value}</Text>
    </View>
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonth() {
  return todayStr().slice(0, 7);
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
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  monthLabel: { ...type.heading, color: colors.ink },

  statRow: { flexDirection: "row", gap: spacing.sm },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: s(2),
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  statValue: { fontSize: s(22), fontWeight: "700", fontVariant: ["tabular-nums"] },
  statLabel: { ...type.small, color: colors.muted, fontSize: s(12) },

  // Calendar
  gridRow: { flexDirection: "row", marginBottom: spacing.xs },
  weekday: { width: `${100 / 7}%`, textAlign: "center", ...type.label, color: colors.muted },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: s(3) },
  dayBtn: {
    flex: 1,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  dayToday: { borderColor: colors.brandBorder },
  daySelected: { borderColor: colors.brand },
  dayNum: { ...type.small, color: colors.muted, fontVariant: ["tabular-nums"] },
  missedDot: {
    position: "absolute",
    top: s(4),
    right: s(4),
    width: s(6),
    height: s(6),
    borderRadius: s(3),
    backgroundColor: colors.warn,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: s(5) },
  legendDot: { width: s(8), height: s(8), borderRadius: s(4) },
  legendText: { ...type.small, fontSize: s(11), color: colors.muted },

  // Selected day
  detail: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    borderLeftWidth: s(4),
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  detailDate: { ...type.heading, color: colors.ink, flex: 1 },
  detailSub: { ...type.small, color: colors.muted },
  timesRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  timeBlock: { gap: s(2) },
  timeLabel: { ...type.label, fontSize: s(10), color: colors.muted },
  timeValue: { ...type.heading, color: colors.ink, fontVariant: ["tabular-nums"] },
  photos: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  office: { ...type.small, color: colors.muted, flex: 1, textAlign: "right" },
  missedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  missedTag: {
    ...type.small, fontSize: s(12), fontWeight: "700", color: colors.warn,
    backgroundColor: colors.warnTint, paddingHorizontal: s(8), paddingVertical: s(3), borderRadius: radius.pill,
    overflow: "hidden",
  },
  missedBtn: {
    borderWidth: 1, borderColor: colors.brandBorder, backgroundColor: colors.brandTint,
    paddingHorizontal: spacing.md, paddingVertical: s(6), borderRadius: radius.pill,
  },
  missedBtnText: { ...type.small, fontSize: s(12), color: colors.brand, fontWeight: "700" },

  // Needs-attention list
  attnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  attnRowOn: { borderColor: colors.brand },
  attnDate: { ...type.body, color: colors.ink },

  // Session breakdown (flex users)
  sessionsBlock: { gap: spacing.xs },
  sessionLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sessionLabel: { ...type.label, color: colors.accent, width: s(22) },
  sessionTimes: { ...type.small, color: colors.ink, fontVariant: ["tabular-nums"], flex: 1 },
  sessionDur: { ...type.small, color: colors.inkSoft, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
