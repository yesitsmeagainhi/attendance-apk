import React, { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, ApiError, Timesheet, TimesheetDay } from "../../src/api/client";
import { Card, Label, Muted, Notice, Title } from "../../src/components/ui";
import { colors, radius, spacing, type } from "../../src/theme";
import { formatDuration, formatTime } from "../../src/lib/punch";

export default function TimesheetScreen() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<Timesheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      setError(null);
      setData(await api.timesheet(m));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your timesheet.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(month);
    }, [load, month]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        contentContainerStyle={styles.list}
        data={data?.days ?? []}
        keyExtractor={(d) => d.date}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => load(month)} tintColor={colors.brand} />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, marginBottom: spacing.lg }}>
            <Title>Timesheet</Title>

            <View style={styles.monthBar}>
              <Pressable
                onPress={() => setMonth(shiftMonth(month, -1))}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <Ionicons name="chevron-back" size={22} color={colors.brand} />
              </Pressable>
              <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
              <Pressable
                onPress={() => setMonth(shiftMonth(month, 1))}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Next month"
                disabled={month >= currentMonth()}
              >
                <Ionicons
                  name="chevron-forward"
                  size={22}
                  color={month >= currentMonth() ? colors.rule : colors.brand}
                />
              </Pressable>
            </View>

            {error ? <Notice>{error}</Notice> : null}

            {data ? (
              <Card>
                <Label>Summary</Label>
                <View style={styles.hoursRow}>
                  <Text style={styles.hours}>{data.totalHoursWorked}</Text>
                  <Text style={styles.hoursUnit}>hours worked</Text>
                </View>
                <View style={styles.statRow}>
                  <Stat value={data.presentDays} label="Present" tone={colors.ok} />
                  <Stat value={data.halfDays} label="Half" tone={colors.warn} />
                  <Stat value={data.leaveDays} label="Leave" tone={colors.brand} />
                  <Stat value={data.absentDays} label="Absent" tone={colors.danger} />
                </View>
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <DayRow day={item} />}
        ListEmptyComponent={loading ? null : <Muted>No entries for this month.</Muted>}
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

function DayRow({ day }: { day: TimesheetDay }) {
  return (
    <View style={styles.row}>
      <View style={styles.dayCol}>
        <Text style={styles.dayNum}>{day.date.slice(8)}</Text>
        <Text style={styles.dayName}>{DAY_NAMES[day.dayOfWeek] ?? ""}</Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowTimes}>
          {formatTime(day.punchIn)} — {formatTime(day.punchOut)}
        </Text>
        <Text style={styles.rowStatus}>{day.status}</Text>
      </View>
      <Text style={styles.rowDuration}>{formatDuration(day.duration)}</Text>
    </View>
  );
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
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
  hoursRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  hours: { fontSize: 34, fontWeight: "700", color: colors.brand, fontVariant: ["tabular-nums"] },
  hoursUnit: { ...type.small, color: colors.muted },
  statRow: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", flex: 1, gap: 2 },
  statValue: { fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  statLabel: { ...type.small, color: colors.muted, fontSize: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  dayCol: { width: 38, alignItems: "center" },
  dayNum: { ...type.heading, color: colors.ink, fontVariant: ["tabular-nums"] },
  dayName: { fontSize: 11, color: colors.muted },
  rowMain: { flex: 1, gap: 2 },
  rowTimes: { ...type.body, color: colors.ink, fontVariant: ["tabular-nums"] },
  rowStatus: { ...type.small, color: colors.muted, textTransform: "capitalize" },
  rowDuration: { ...type.small, color: colors.inkSoft, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
