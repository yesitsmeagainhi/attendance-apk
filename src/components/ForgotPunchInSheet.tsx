import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, type } from "../theme";
import { s } from "../lib/responsive";
import { formatShiftTime } from "../lib/punch";

/** Current time in India as "3:45 PM", whatever the phone's time zone. */
function istClock(): string {
  const d = new Date(Date.now() + 330 * 60_000);
  return formatShiftTime(`${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`);
}

/**
 * Bottom sheet asking "Did you forget to punch in?" before a late first punch
 * of the day. Requesting the missed punch-in first means this punch is saved
 * as the punch-out, so no second request is needed.
 */
export default function ForgotPunchInSheet({
  visible,
  shiftStart,
  onRequest,
  onPunchNow,
  onClose,
}: {
  visible: boolean;
  shiftStart: string;
  onRequest: () => void;
  onPunchNow: () => void;
  onClose: () => void;
}) {
  const { bottom } = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: spacing.xl + bottom }]}>
        <View style={styles.handle} />

        <View style={styles.iconWrap}>
          <Ionicons name="alarm-outline" size={s(30)} color={colors.warn} />
        </View>

        <Text style={styles.title}>Did you forget to punch in?</Text>
        <Text style={styles.body}>There&apos;s no punch-in recorded for today.</Text>

        <View style={styles.times}>
          <View style={styles.timeCell}>
            <Text style={styles.timeLabel}>Shift started</Text>
            <Text style={styles.timeValue}>{formatShiftTime(shiftStart)}</Text>
          </View>
          <View style={styles.timeDivider} />
          <View style={styles.timeCell}>
            <Text style={styles.timeLabel}>Time now</Text>
            <Text style={styles.timeValue}>{istClock()}</Text>
          </View>
        </View>

        <View style={styles.tip}>
          <Ionicons name="information-circle-outline" size={s(18)} color={colors.brand} />
          <Text style={styles.tipText}>
            Were you at work since morning? Request the missed punch-in first. This punch is then saved as your{" "}
            <Text style={{ fontWeight: "700" }}>punch-out</Text>, and you won&apos;t need a second request.
          </Text>
        </View>

        <Pressable
          onPress={onRequest}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Ionicons name="document-text-outline" size={s(18)} color={colors.white} />
          <Text style={styles.primaryText}>Yes, request punch-in</Text>
        </Pressable>

        <Pressable
          onPress={onPunchNow}
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Ionicons name="camera-outline" size={s(18)} color={colors.brand} />
          <Text style={styles.secondaryText}>No, I&apos;m starting work now</Text>
        </Pressable>

        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8} style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(13,26,61,0.45)" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: s(24),
    borderTopRightRadius: s(24),
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    alignItems: "center",
    gap: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 20,
  },
  handle: { width: s(40), height: s(4), borderRadius: 2, backgroundColor: colors.rule, marginBottom: spacing.sm },
  iconWrap: {
    width: s(60), height: s(60), borderRadius: s(30),
    backgroundColor: colors.warnTint, alignItems: "center", justifyContent: "center",
  },
  title: { ...type.title, color: colors.ink, textAlign: "center" },
  body: { ...type.body, color: colors.inkSoft, textAlign: "center", marginTop: -spacing.xs },
  times: {
    flexDirection: "row", alignSelf: "stretch",
    backgroundColor: colors.bg, borderRadius: radius.md, paddingVertical: spacing.md,
  },
  timeCell: { flex: 1, alignItems: "center", gap: s(2) },
  timeDivider: { width: 1, backgroundColor: colors.rule },
  timeLabel: { ...type.label, color: colors.muted },
  timeValue: { fontSize: s(20), fontWeight: "700", color: colors.ink, fontVariant: ["tabular-nums"] },
  tip: {
    flexDirection: "row", gap: spacing.sm, alignSelf: "stretch",
    backgroundColor: colors.brandTint, borderRadius: radius.md, padding: spacing.md,
  },
  tipText: { ...type.small, color: colors.inkSoft, lineHeight: s(19), flex: 1 },
  primary: {
    flexDirection: "row", gap: spacing.sm, alignSelf: "stretch",
    backgroundColor: colors.brand, borderRadius: radius.lg, minHeight: s(52),
    alignItems: "center", justifyContent: "center", marginTop: spacing.xs,
  },
  primaryText: { ...type.heading, color: colors.white, fontWeight: "700" },
  secondary: {
    flexDirection: "row", gap: spacing.sm, alignSelf: "stretch",
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.brandBorder, borderRadius: radius.lg,
    minHeight: s(52), alignItems: "center", justifyContent: "center",
  },
  secondaryText: { ...type.heading, color: colors.brand, fontWeight: "700" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  cancel: { paddingVertical: spacing.xs },
  cancelText: { ...type.body, color: colors.muted, fontWeight: "600" },
});
