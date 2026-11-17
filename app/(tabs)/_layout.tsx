import { useRef } from "react";
import { Animated, Platform, Pressable } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors } from "../../src/theme";
import { s } from "../../src/lib/responsive";

/**
 * A barely-there tick when switching tabs.
 *
 * Android: the system haptic engine's "segment tick" (the tick a picker makes),
 * which follows the phone's own Touch feedback setting. impactAsync drives the
 * vibration motor directly instead, and even "Light" is a full buzz on many
 * Android phones. iOS: the standard selection tick.
 */
function tabTick() {
  const p =
    Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick)
      : Haptics.selectionAsync();
  p.catch(() => {}); // haptics are a nicety; never let them throw
}

/**
 * Wraps every tab button with:
 *   1. A subtle haptic tick, only when actually switching to another tab
 *   2. A quick scale-pop on the icon so the press registers visually
 * The Android system click sound is turned off; the tick is the feedback.
 */
function HapticTabButton({ children, onPress, style, ...rest }: any) {
  const scale = useRef(new Animated.Value(1)).current;
  const selected = !!(rest["aria-selected"] ?? rest.accessibilityState?.selected);

  function handlePress(e: any) {
    if (!selected) tabTick();
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.82, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }),
    ]).start();
    onPress?.(e);
  }

  return (
    <Pressable
      onPress={handlePress}
      android_disableSound
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={rest.accessibilityLabel ?? rest["aria-label"]}
      testID={rest.testID}
      style={[style, { flex: 1, alignItems: "center", justifyContent: "center" }]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { bottom } = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarButton: (props) => <HapticTabButton {...props} />,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.rule,
          borderTopWidth: 1,
          height: s(62) + bottom,
          paddingBottom: s(8) + bottom,
          paddingTop: s(6),
          shadowColor: "#1A2D62",
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.07,
          shadowRadius: 10,
          elevation: 10,
        },
        tabBarLabelStyle: { fontSize: s(11), fontWeight: "600", letterSpacing: 0.2 },
        tabBarActiveBackgroundColor: "transparent",
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="timesheet"
        options={{
          title: "Timesheet",
          tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: "Requests",
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
