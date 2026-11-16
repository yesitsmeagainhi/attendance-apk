import React, { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import AnimatedSplash from "../src/components/AnimatedSplash";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { colors } from "../src/theme";

// Keep the native logo splash up until the animated intro (AnimatedSplash)
// has painted an identical frame; it then hides the native one with no fade,
// so the handoff is invisible.
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 0, fade: false });

// Never strand the user on the splash, whatever happens during restore
const SPLASH_FAILSAFE_MS = 8000;
setTimeout(() => SplashScreen.hide(), SPLASH_FAILSAFE_MS);

function Gate() {
  const { session, restoring } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Gate on the login route only. Testing for "inside (tabs)" instead would
  // bounce every other authenticated route -- /punch and /journal included --
  // straight back to the tab stack the moment they mounted.
  const onLogin = segments[0] === "login";
  // On the screen the session calls for: safe to reveal the app
  const settled = !restoring && (session ? !onLogin : onLogin);

  useEffect(() => {
    if (restoring) return;
    if (!session && !onLogin) router.replace("/login");
    else if (session && onLogin) router.replace("/(tabs)");
  }, [session, restoring, onLogin, router]);

  return (
    <View style={{ flex: 1 }}>
      {/* The animated intro covers this until the session is restored */}
      {restoring ? null : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="login" options={{ animation: "fade" }} />
          <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
          <Stack.Screen name="punch" options={{ presentation: "fullScreenModal" }} />
          <Stack.Screen name="journal" />
          <Stack.Screen name="payslips" />
        </Stack>
      )}
      <AnimatedSplash ready={settled} />
    </View>
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
