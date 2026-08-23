import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { NotificationProvider } from "../src/notifications/NotificationCenter";
import { colors } from "../src/theme";

function Gate() {
  const { session, restoring } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (restoring) return;
    // Gate on the login route only. Testing for "inside (tabs)" instead would
    // bounce every other authenticated route -- /punch and /journal included --
    // straight back to the tab stack the moment they mounted.
    const onLogin = segments[0] === "login" || segments[0] === "admin-login";
    const isAdmin = session?.role === "admin";
    if (!session && !onLogin) {
      router.replace("/login");
    } else if (session && onLogin) {
      router.replace(isAdmin ? "/(admin)" : "/(tabs)");
    } else if (session) {
      // Keep each role in its own stack. An admin has no attendance record, so
      // the employee tabs render empty for them, and an employee calling an
      // admin route would only collect 403s.
      const inAdmin = segments[0] === "(admin)";
      const inTabs = segments[0] === "(tabs)";
      if (isAdmin && inTabs) router.replace("/(admin)");
      else if (!isAdmin && inAdmin) router.replace("/(tabs)");
    }
  }, [session, restoring, segments, router]);

  if (restoring) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="admin-login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(admin)" />
      {/* Admin detail routes live on the root stack, not inside the tab group,
          so they open full screen over the tab bar. */}
      <Stack.Screen name="admin-attendance" />
      <Stack.Screen name="admin-employee" />
      <Stack.Screen name="admin-employee-month" />
      <Stack.Screen name="admin-employee-rules" />
      <Stack.Screen name="admin-settings" />
      <Stack.Screen name="admin-history" />
      <Stack.Screen name="admin-journals" />
      <Stack.Screen name="admin-codes" />
      <Stack.Screen name="admin-profile" />
      {/* Shared by both roles: the feed underneath is role-aware. */}
      <Stack.Screen name="notifications" />
      <Stack.Screen name="punch" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="journal" options={{ presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        {/* Inside AuthProvider: the watchers key off the signed-in role, and
            must reset when the session changes. */}
        <NotificationProvider>
          <StatusBar style="dark" />
          <Gate />
        </NotificationProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
