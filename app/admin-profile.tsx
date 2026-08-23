import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../src/auth/AuthContext";
import { IconButton, ScreenHeader } from "../src/components/adminui";
import { Button, Card, Label, Muted } from "../src/components/ui";
import { colors, spacing, type } from "../src/theme";
import { API_BASE_URL, IS_PRODUCTION_TARGET } from "../src/config";

/** Admin profile. The employee version reads /api/employee/profile, which an
 *  admin has no attendance record behind, so this shows the session instead. */
export default function AdminProfileScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="Profile"
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.scroll}>

        <Card>
          <Row label="Name" value={session?.name || "—"} />
          <Row label="Account ID" value={session?.employeeId || "—"} />
          <Row label="Access level" value={session?.role || "—"} />
        </Card>

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
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  rowLabel: { ...type.body, color: colors.inkSoft },
  rowValue: { ...type.body, color: colors.ink, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  server: { ...type.small, color: colors.muted, textAlign: "center", fontSize: 11 },
});
