import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
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
  const signedIn = !!session;

  // Protected routes instead of a redirect effect: while signed out the
  // signed-in screens don't exist, so the router opens Login directly (and the
  // reverse when signed in). The old effect let Today mount for a moment and
  // then replaced it with Login; that discarded mount is what logged "Can't
  // perform a React state update on a component that hasn't mounted yet".
  // Signing in or out flips the guards, and the router moves to the screen
  // that is now available.
  return (
    <View style={{ flex: 1 }}>
      {/* The animated intro covers this until the session is restored */}
      {restoring ? null : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
            <Stack.Screen name="punch" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="journal" />
            <Stack.Screen name="payslips" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="login" options={{ animation: "fade" }} />
          </Stack.Protected>
        </Stack>
      )}
      <AnimatedSplash ready={!restoring} />
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
