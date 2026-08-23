import React, { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { api, ApiError, HistoryRecord, HistoryResponse } from "../../src/api/client";
import { Notice } from "../../src/components/ui";
import {
  EmptyState,
  Loading,
  Row,
  ScreenHeader,
  StatStrip,
  StatusPill,
} from "../../src/components/adminui";
import { NotificationBell } from "../../src/components/NotificationBell";
import { PhotoViewer, PunchThumb } from "../../src/components/PunchPhoto";
import { colors, radius, spacing, statusColors } from "../../src/theme";
import { formatDate, formatDuration, formatTime } from "../../src/lib/punch";

type Viewing = { key: string; caption: string } | null;

/**
 * "2026-08-22" -> "August 2026".
 *
 * Taken from the first record rather than the device clock where possible: the
 * endpoint decides which month it returns, so labelling the screen from what
 * actually came back can never disagree with the rows underneath it. Falls back
 * to today for an empty month, which is the month the endpoint defaults to.
 */
function monthLabel(iso: string | undefined): string {
  const parsed = iso ? new Date(`${iso}T00:00:00`) : new Date();
  const d = isNaN(parsed.getTime()) ? new Date() : parsed;
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * The employee's own attendance history.
 *
 * One card per day: the date, the two punch times, how long the day ran, and
 * the status as a pill. Everything numeric is hoisted into the strip at the top
 * instead of being repeated down the list.
 *
 * The selfies stay on the card rather than moving behind a tap — they are the
 * proof the punch happened, and an employee querying a day wants to see the
 * photo the office saw. They sit in a strip under the row, inside the same
 * card, so the row line itself stays as quiet as every other list in the app.
 *
 * There is no month picker: the endpoint takes an optional `month`, but this
 * screen has always called it bare and gets the current month back. A stepper
 * would mean sending a query param this client has never sent in production, so
 * it is left for a change that can be tested against the live server.
 */
export default function HistoryScreen() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewing, setViewing] = useState<Viewing>(null);

  /**
   * Every load takes a ticket and only the newest one may write state. Two
   * fetches overlap routinely here -- tab away and back on a slow connection,
   * or pull-to-refresh racing the reload that focus fires -- and without this
   * the slower reply wins by arriving last: an older month repainted over a
   * newer one, or worse, a request that timed out after a later one succeeded
   * hanging an error banner over a list that had just loaded fine.
   */
  const ticket = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      setError(null);
      const next = await api.history();
      if (mine !== ticket.current) return;
      setData(next);
    } catch (e) {
      if (mine !== ticket.current) return;
      // The last good month stays on screen behind the notice: a list the user
      // can still read beats blanking the screen over one failed refresh.
      setError(e instanceof ApiError ? e.message : "Couldn't load your history.");
    } finally {
      // Never stranded: the newest ticket always reaches this line, and only it
      // is allowed to lower the flag.
      if (mine === ticket.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      // Blur retires whatever is in flight. Its answer is about a screen the
      // user has already left, and coming back asks again regardless.
      return () => {
        ticket.current++;
      };
    }, [load]),
  );

  /**
   * Pull-to-refresh drives its own flag. Wired to `loading` it never showed a
   * spinner at all, because `load` only ever lowers that flag after first paint.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const records = data?.records ?? [];
  const label = monthLabel(records[0]?.date);

  const stats = data
    ? [
        { label: "Present", value: data.presentDays, tone: colors.ok },
        { label: "Late", value: data.lateDays, tone: colors.warn },
        { label: "Half", value: data.halfDays, tone: colors.warn },
        { label: "Absent", value: data.absentDays, tone: colors.danger },
        // Leave earns a column only when it happened. Five of them crowd a
        // 360dp screen, and zero leave days is the ordinary month.
        ...(data.leaveDays > 0
          ? [{ label: "Leave", value: data.leaveDays, tone: colors.brand }]
          : []),
      ]
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="History"
        subtitle={data || error ? label : `${label} · loading…`}
        right={<NotificationBell />}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        {stats ? <StatStrip stats={stats} /> : null}

        {loading && !data ? <Loading /> : null}

        {records.map((r) => (
          <RecordCard key={r.date} record={r} onView={setViewing} />
        ))}

        {data && !loading && !records.length ? (
          <EmptyState
            icon="calendar-outline"
            title="Nothing recorded yet"
            body="Your punches for this month will show up here."
          />
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

/**
 * Memoised: this list is a plain ScrollView, so without it every tap on a
 * thumbnail re-rendered all thirty-odd cards. Both props are stable -- the
 * record comes straight off the loaded page and onView is a setState.
 */
const RecordCard = React.memo(function RecordCard({
  record,
  onView,
}: {
  record: HistoryRecord;
  onView: (v: Viewing) => void;
}) {
  const tone = statusColors(record.status);
  const day = formatDate(record.date);

  // Bound to consts so the callbacks below narrow on their own rather than
  // leaning on a non-null assertion over a field the server can send as null.
  const inKey = record.photoKeyIn;
  const outKey = record.photoKeyOut;

  const times =
    record.punchInTime || record.punchOutTime
      ? `${formatTime(record.punchInTime)} – ${formatTime(record.punchOutTime)}`
      : "No punches";

  // An absent day has no hours and no office, so it gets no third line at all
  // rather than a row of em dashes.
  const bits: string[] = [];
  if (record.duration) bits.push(formatDuration(record.duration));
  if (record.office) bits.push(record.office);

  return (
    <View style={styles.record}>
      <Row
        title={day}
        subtitle={times}
        meta={bits.length ? bits.join(" · ") : undefined}
        right={<StatusPill label={record.status} fg={tone.fg} bg={tone.bg} />}
      />

      {inKey || outKey ? (
        <View style={styles.photos}>
          {inKey ? (
            <PunchThumb
              photoKey={inKey}
              label="IN"
              onPress={() =>
                onView({
                  key: inKey,
                  caption: `Punch in · ${day} · ${formatTime(record.punchInTime)}`,
                })
              }
            />
          ) : null}
          {outKey ? (
            <PunchThumb
              photoKey={outKey}
              label="OUT"
              onPress={() =>
                onView({
                  key: outKey,
                  caption: `Punch out · ${day} · ${formatTime(record.punchOutTime)}`,
                })
              }
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  /**
   * Row paints its own card. The wrapper carries the same colour and radius, so
   * the row's rounded corners land on an identical background and the row plus
   * its photo strip read as one card rather than two stacked ones.
   */
  record: { backgroundColor: colors.card, borderRadius: radius.md, overflow: "hidden" },
  photos: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    // Clears the IN/OUT tag, which hangs 4px below the thumbnail.
    paddingBottom: spacing.md,
  },
});
