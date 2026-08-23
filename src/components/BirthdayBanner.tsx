import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNotifications } from "../notifications/NotificationCenter";
import { colors, radius, spacing, type } from "../theme";

/**
 * The birthday wish that rolls across the top of the home screens.
 *
 * It renders nothing at all when nobody has a birthday, so it costs no vertical
 * space on an ordinary day. The marquee is driven by Animated with
 * `useNativeDriver`, so it keeps moving on the UI thread while the list below
 * is being scrolled or refetched.
 */
export function BirthdayBanner() {
  const { birthdays } = useNotifications();
  const x = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);

  const names = birthdays.map((b) => b.name);
  const message =
    names.length === 0
      ? ""
      : names.length === 1
        ? `🎉 Today is ${names[0]}'s birthday — wish them a happy birthday! 🎂`
        : `🎉 Today is the birthday of ${names.slice(0, -1).join(", ")} and ${
            names[names.length - 1]
          } — wish them a happy birthday! 🎂`;

  useEffect(() => {
    if (!message || !trackWidth || !textWidth) return;

    // Scroll one full text width plus the track, so the message leaves the
    // screen completely before it comes back around.
    const distance = textWidth + trackWidth;
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -textWidth,
        // ~45 logical pixels per second reads comfortably without hurrying.
        duration: Math.max(6000, (distance / 45) * 1000),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    x.setValue(trackWidth);
    loop.start();
    return () => {
      loop.stop();
    };
  }, [message, trackWidth, textWidth, x]);

  if (!message) return null;

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      accessibilityRole="text"
      accessibilityLabel={message}
    >
      <View style={styles.cake}>
        <Ionicons name="gift" size={15} color={colors.white} />
      </View>
      <View style={styles.track}>
        <Animated.Text
          numberOfLines={1}
          onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}
          style={[styles.text, { transform: [{ translateX: x }] }]}
        >
          {message}
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#FFF6E6",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#F6D9A8",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    overflow: "hidden",
  },
  cake: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.warn,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { flex: 1, overflow: "hidden", height: 20, justifyContent: "center" },
  text: { ...type.small, color: "#8A5A00", fontWeight: "700" },
});
