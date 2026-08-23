import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useNotifications } from "../notifications/NotificationCenter";
import { colors, radius, type } from "../theme";

/**
 * Header bell with an unread count. Shared by both roles — the feed underneath
 * is role-aware, so the same control serves an admin watching the office and an
 * employee watching their own requests.
 */
export function NotificationBell() {
  const router = useRouter();
  const { unread } = useNotifications();

  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name="notifications-outline" size={20} color={colors.ink} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeText: { ...type.small, color: colors.white, fontSize: 10, fontWeight: "700" },
});
