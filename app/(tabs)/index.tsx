import React, { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { api, ApiError, PunchStatus } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, Label, Muted, Notice, Pill, Title } from "../../src/components/ui";
import { colors, radius, spacing, type } from "../../src/theme";
import { formatTime } from "../../src/lib/punch";

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
          <View style={styles.mark}>
            <Text style={styles.markText}>
              {(session?.name || "A").trim().charAt(0).toUpperCase()}
            </Text>
          </View>
        </View>

        {error ? <Notice>{error}</Notice> : null}

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
            Shift {status?.workStartTime ?? "--"} to {status?.workEndTime ?? "--"}
            {status?.flexibleHours ? " · flexible hours" : ""}
          </Muted>
        </Card>

        <Card>
          <Label>Mark attendance</Label>
          {canPunch ? (
            <>
              <Muted>
                You'll take a selfie and Attendly will check you're inside an office
                geo-fence before recording the time.
              </Muted>
              <Button
                label={nextType === "IN" ? "Punch in" : "Punch out"}
                onPress={() => router.push({ pathname: "/punch", params: { type: nextType! } })}
              />
            </>
          ) : (
            <Notice tone="ok">
              {status?.punchOut
                ? "You're done for today. Both punches are recorded."
                : loading
                  ? "Checking your status..."
                  : "No punch is available right now."}
            </Notice>
          )}
        </Card>

        <Card>
          <Label>Daily journal</Label>
          <Muted>Log what you worked on today and what's queued for tomorrow.</Muted>
          <Button
            label="Open today's journal"
            variant="secondary"
            onPress={() => router.push("/journal")}
          />
        </Card>

        {status && status.punches.length > 0 ? (
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mark: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { color: colors.white, fontSize: 18, fontWeight: "700" },
  punchRow: { flexDirection: "row", alignItems: "center" },
  punchCell: { flex: 1, gap: 4 },
  divider: { width: 1, alignSelf: "stretch", backgroundColor: colors.rule, marginHorizontal: spacing.md },
  punchLabel: { ...type.small, color: colors.muted },
  punchTime: { fontSize: 26, fontWeight: "700", color: colors.ink, fontVariant: ["tabular-nums"] },
  logRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logTime: { ...type.body, color: colors.ink, fontWeight: "600", fontVariant: ["tabular-nums"] },
  logOffice: { ...type.small, color: colors.muted, flex: 1 },
});
