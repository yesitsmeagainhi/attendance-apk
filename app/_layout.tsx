import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
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
    const onLogin = segments[0] === "login";
    if (!session && !onLogin) router.replace("/login");
    else if (session && onLogin) router.replace("/(tabs)");
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
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="punch" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="journal" />
      <Stack.Screen name="payslips" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
