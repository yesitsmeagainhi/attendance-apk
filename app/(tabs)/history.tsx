import React, { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { api, ApiError, HistoryRecord, HistoryResponse } from "../../src/api/client";
import { Card, Label, Muted, Notice, Pill, Title } from "../../src/components/ui";
import { PhotoViewer, PunchThumb } from "../../src/components/PunchPhoto";
import { colors, radius, spacing, statusColors, type } from "../../src/theme";
import { formatDate, formatDuration, formatTime } from "../../src/lib/punch";

type Viewing = { key: string; caption: string } | null;

export default function HistoryScreen() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Viewing>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.history());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your history.");
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
      <FlatList
        contentContainerStyle={styles.list}
        data={data?.records ?? []}
        keyExtractor={(r) => r.date}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, marginBottom: spacing.lg }}>
            <Title>Your attendance</Title>
            {error ? <Notice>{error}</Notice> : null}
            {data ? (
              <Card>
                <Label>This month</Label>
                <View style={styles.statRow}>
                  <Stat value={data.presentDays} label="Present" tone={colors.ok} />
                  <Stat value={data.lateDays} label="Late" tone={colors.warn} />
                  <Stat value={data.halfDays} label="Half" tone={colors.warn} />
                  <Stat value={data.absentDays} label="Absent" tone={colors.danger} />
                </View>
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <Row record={item} onViewPhoto={setViewing} />}
        ListEmptyComponent={loading ? null : <Muted>No attendance records yet.</Muted>}
      />

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

function Row({
  record,
  onViewPhoto,
}: {
  record: HistoryRecord;
  onViewPhoto: (v: Viewing) => void;
}) {
  const sc = statusColors(record.status);
  const hasPhotos = !!(record.photoKeyIn || record.photoKeyOut);

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.rowMain}>
          <Text style={styles.rowDate}>{formatDate(record.date)}</Text>
          <Text style={styles.rowTimes}>
            {formatTime(record.punchInTime)} — {formatTime(record.punchOutTime)}
            {record.duration ? `  ·  ${formatDuration(record.duration)}` : ""}
          </Text>
        </View>
        <Pill text={record.status} fg={sc.fg} bg={sc.bg} />
      </View>

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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statRow: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", flex: 1, gap: 2 },
  statValue: { fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  statLabel: { ...type.small, color: colors.muted, fontSize: 12 },
  row: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  rowMain: { flex: 1, gap: 3 },
  rowDate: { ...type.heading, color: colors.ink },
  rowTimes: { ...type.small, color: colors.muted, fontVariant: ["tabular-nums"] },
  photos: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  office: { ...type.small, color: colors.muted, flex: 1, textAlign: "right" },
});
