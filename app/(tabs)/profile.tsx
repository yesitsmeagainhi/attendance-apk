import React, { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { api, ApiError, Profile } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, Label, Muted, Notice, Title } from "../../src/components/ui";
import { colors, spacing, type } from "../../src/theme";
import { API_BASE_URL, IS_PRODUCTION_TARGET } from "../../src/config";

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.profile();
      setProfile(res.profile);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your profile.");
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
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
      >
        <Title>Profile</Title>
        {error ? <Notice>{error}</Notice> : null}

        {profile ? (
          <Card>
            <Row label="Name" value={profile.name} />
            <Row label="Employee ID" value={profile.id} />
            <Row label="Role" value={profile.jobRole || "—"} />
            <Row label="Office" value={profile.office} />
            <Row label="Shift" value={`${profile.workStartTime} – ${profile.workEndTime}`} />
            <Row label="Mobile" value={profile.mobileNumber || "—"} />
            {/* <Row label="Email" value={profile.email} /> */}
          </Card>
        ) : null}

        <Card>
          <Label>Session</Label>
          <Muted>
            You are signed in on this device only. Signing in on another device — or in a
            browser — will end this session.
          </Muted>
          <Button
            label="Sign out"
            variant="danger"
            busy={signingOut}
            onPress={async () => {
              setSigningOut(true);
              await signOut();
            }}
          />
        </Card>

        <Text style={styles.server}>
          {IS_PRODUCTION_TARGET ? "Server" : "Dev server"} · {API_BASE_URL}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.lg },
  rowLabel: { ...type.small, color: colors.muted },
  rowValue: { ...type.body, color: colors.ink, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  server: { ...type.small, color: colors.muted, fontSize: 11, textAlign: "center" },
});
