import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/auth/AuthContext";
import { Avatar, Row, ScreenHeader, SectionHeader } from "../../src/components/adminui";
import { colors, spacing, type } from "../../src/theme";
import { API_BASE_URL, IS_PRODUCTION_TARGET } from "../../src/config";

type Entry = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  hint: string;
  route: string;
};

/** The web dashboard's less-frequent tabs, plus the session controls. */
const SECTIONS: Array<{ title: string; entries: Entry[] }> = [
  {
    title: "Daily",
    entries: [
      {
        icon: "key-outline",
        label: "Login codes",
        hint: "Read an employee their OTP",
        route: "/admin-codes",
      },
      {
        icon: "book-outline",
        label: "Journals",
        hint: "What staff logged for the day",
        route: "/admin-journals",
      },
    ],
  },
  {
    title: "Office",
    entries: [
      {
        icon: "settings-outline",
        label: "Settings",
        hint: "Branches, departments, attendance rules",
        route: "/admin-settings",
      },
      {
        icon: "time-outline",
        label: "Activity log",
        hint: "Who changed what, and when",
        route: "/admin-history",
      },
    ],
  },
];

export default function AdminMoreScreen() {
  const router = useRouter();
  const { session } = useAuth();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="More" subtitle={session?.name ?? undefined} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section}>
            <SectionHeader title={s.title} />
            {s.entries.map((e) => (
              <Row
                key={e.route}
                left={<Ionicons name={e.icon} size={22} color={colors.brand} />}
                title={e.label}
                subtitle={e.hint}
                onPress={() => router.push(e.route as never)}
              />
            ))}
          </View>
        ))}

        <View style={styles.section}>
          <SectionHeader title="Account" />
          <Row
            left={<Avatar name={session?.name || "Admin"} size={34} />}
            title={session?.name || "Admin"}
            subtitle={`${session?.employeeId ?? "—"} · ${session?.role ?? "—"}`}
            onPress={() => router.push("/admin-profile")}
          />
        </View>

        <Text style={styles.server}>
          {IS_PRODUCTION_TARGET ? "Server" : "Dev server"} · {API_BASE_URL}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.lg, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  server: { ...type.small, color: colors.muted, textAlign: "center", fontSize: 11, marginTop: spacing.lg },
});
