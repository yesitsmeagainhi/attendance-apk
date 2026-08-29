import { useCallback, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { api, ApiError, PunchStatus } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, Label, Muted, Notice, Pill, Title } from "../../src/components/ui";
import { colors, radius, spacing, type } from "../../src/theme";
import { s } from "../../src/lib/responsive";
import { formatTime, formatShiftTime, formatDuration } from "../../src/lib/punch";
import { groupPunchesIntoSessions, Session, SessionSummary } from "../../src/lib/sessions";

export default function TodayScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<PunchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      setStatus(await api.status());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load today's attendance.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch on focus so returning from the camera shows the new punch.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const nextType = status?.nextPunchType ?? null;
  const canPunch = !!nextType && (nextType === "IN" ? status?.canPunchIn : status?.canPunchOut);
  const isFlex = !!status?.flexibleHours;

  const sessionData: SessionSummary | null =
    isFlex && status && status.punches.length > 0
      ? groupPunchesIntoSessions(status.punches)
      : null;

  // Context-aware button labels for flexible users
  const punchButtonLabel = isFlex && sessionData
    ? nextType === "IN"
      ? `Start Session ${sessionData.nextSessionNumber}`
      : `End Session ${sessionData.currentSession?.index ?? sessionData.nextSessionNumber}`
    : isFlex && nextType === "IN"
      ? "Start Session 1"
      : nextType === "IN"
        ? "Punch in"
        : "Punch out";

  const sessionNumber = isFlex && sessionData
    ? nextType === "IN"
      ? sessionData.nextSessionNumber
      : (sessionData.currentSession?.index ?? sessionData.nextSessionNumber)
    : isFlex
      ? 1
      : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
      >
        <View style={styles.header}>
          <View>
            <Label>Signed in as</Label>
            <Title>{session?.name || "Employee"}</Title>
          </View>
          <Image source={require("../../assets/app-icon.jpg")} style={styles.mark} />
        </View>

        {error ? <Notice>{error}</Notice> : null}

        {/* ── Today card ─────────────────────────────────── */}
        {isFlex ? (
          <Card>
            <Label>Today's sessions</Label>

            {sessionData ? (
              <>
                {sessionData.sessions.map((ses, i) => (
                  <SessionRow
                    key={ses.index}
                    session={ses}
                    isLast={i === sessionData.sessions.length - 1}
                  />
                ))}
                <Text style={styles.summaryText}>
                  {sessionData.completedCount > 0
                    ? `${sessionData.completedCount} lecture${sessionData.completedCount !== 1 ? "s" : ""} completed · ${formatDuration(sessionData.totalMinutes)} total`
                    : "Session in progress"}
                </Text>
              </>
            ) : (
              <Muted>No sessions yet today.</Muted>
            )}

            <Muted>
              Shift {formatShiftTime(status?.workStartTime)} to {formatShiftTime(status?.workEndTime)} · flexible hours
            </Muted>
          </Card>
        ) : (
          <Card>
            <Label>Today</Label>
            <View style={styles.punchRow}>
              <View style={styles.punchCell}>
                <Text style={styles.punchLabel}>Punch in</Text>
                <Text style={styles.punchTime}>{formatTime(status?.punchIn?.time)}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.punchCell}>
                <Text style={styles.punchLabel}>Punch out</Text>
                <Text style={styles.punchTime}>{formatTime(status?.punchOut?.time)}</Text>
              </View>
            </View>

            {status?.office ? (
              <Pill text={status.office} fg={colors.brand} bg={colors.brandTint} />
            ) : null}

            <Muted>
              Shift {formatShiftTime(status?.workStartTime)} to {formatShiftTime(status?.workEndTime)}
            </Muted>
          </Card>
        )}

        {/* ── Mark attendance ────────────────────────────── */}
        <Card>
          <Label>Mark attendance</Label>
          {canPunch ? (
            <>
              <Muted>
                You'll take a selfie and application will check you're inside an office
                geo-fence before recording the time.
              </Muted>
              <Button
                label={punchButtonLabel}
                onPress={() =>
                  router.push({
                    pathname: "/punch",
                    params: {
                      type: nextType!,
                      ...(sessionNumber != null ? { sessionNumber: String(sessionNumber) } : {}),
                    },
                  })
                }
              />
            </>
          ) : (
            <Notice tone="ok">
              {isFlex && status?.punchOut && !nextType
                ? "All sessions complete for today."
                : status?.punchOut
                  ? "You're done for today. Both punches are recorded."
                  : loading
                    ? "Checking your status..."
                    : "No punch is available right now."}
            </Notice>
          )}
        </Card>

        {/* ── Daily journal ──────────────────────────────── */}
        <Card>
          <Label>Daily journal</Label>
          <Muted>Log what you worked on today and what's queued for tomorrow.</Muted>
          <Button
            label="Open today's journal"
            variant="secondary"
            onPress={() => router.push("/journal")}
          />
        </Card>

        {/* ── Flat punch log (regular users only) ────────── */}
        {status && status.punches.length > 0 && !isFlex ? (
          <Card>
            <Label>Today's punches</Label>
            {status.punches.map((p, i) => (
              <View key={`${p.time}-${i}`} style={styles.logRow}>
                <Pill
                  text={p.type}
                  fg={p.type === "IN" ? colors.ok : colors.warn}
                  bg={p.type === "IN" ? colors.okTint : colors.warnTint}
                />
                <Text style={styles.logTime}>{formatTime(p.time)}</Text>
                <Text style={styles.logOffice} numberOfLines={1}>
                  {p.office}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Session row component ──────────────────────────── */

function SessionRow({ session: ses, isLast }: { session: Session; isLast: boolean }) {
  const ongoing = !ses.punchOut;
  return (
    <View style={[styles.sessionRow, isLast && { borderBottomWidth: 0 }]}>
      <View style={styles.sessionHeader}>
        <Text style={styles.sessionTitle}>Session {ses.index}</Text>
        <Pill
          text={ongoing ? "ONGOING" : formatDuration(ses.durationMinutes)}
          fg={ongoing ? colors.accent : colors.ok}
          bg={ongoing ? colors.accentTint : colors.okTint}
        />
      </View>
      <Text style={styles.sessionTimes}>
        {formatTime(ses.punchIn.time)}
        {" → "}
        {ongoing ? "ongoing" : formatTime(ses.punchOut!.time)}
      </Text>
      <Text style={styles.sessionOffice}>{ses.punchIn.office}</Text>
    </View>
  );
}

/* ── Styles ──────────────────────────────────────────── */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mark: {
    width: s(44),
    height: s(44),
    borderRadius: radius.pill,
  },
  punchRow: { flexDirection: "row", alignItems: "center" },
  punchCell: { flex: 1, gap: s(4) },
  divider: { width: 1, alignSelf: "stretch", backgroundColor: colors.rule, marginHorizontal: spacing.md },
  punchLabel: { ...type.small, color: colors.muted },
  punchTime: { fontSize: s(26), fontWeight: "700", color: colors.ink, fontVariant: ["tabular-nums"] },
  logRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logTime: { ...type.body, color: colors.ink, fontWeight: "600", fontVariant: ["tabular-nums"] },
  logOffice: { ...type.small, color: colors.muted, flex: 1 },
  // Session styles (flexible-hours users)
  sessionRow: {
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  sessionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sessionTitle: { ...type.heading, color: colors.ink },
  sessionTimes: { ...type.body, color: colors.ink, fontVariant: ["tabular-nums"] },
  sessionOffice: { ...type.small, color: colors.muted },
  summaryText: { ...type.body, color: colors.inkSoft, fontWeight: "600" },
});
