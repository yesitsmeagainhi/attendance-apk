import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from "react-native";
import { colors, radius, spacing, type } from "../theme";

export function Card({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.card, style]} />;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{String(children).toUpperCase()}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || busy;
  const palette =
    variant === "primary"
      ? { bg: colors.brand, fg: colors.white }
      : variant === "danger"
        ? { bg: colors.dangerTint, fg: colors.danger }
        : { bg: colors.brandTint, fg: colors.brand };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!busy }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, opacity: isDisabled ? 0.55 : pressed ? 0.88 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text style={[styles.buttonLabel, { color: palette.fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...rest
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Label>{label}</Label>
      <TextInput
        {...rest}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      {hint ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

export function Pill({ text, fg, bg }: { text: string; fg: string; bg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Notice({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "warn" | "ok";
  children: React.ReactNode;
}) {
  const palette =
    tone === "ok"
      ? { bg: colors.okTint, fg: colors.ok }
      : tone === "warn"
        ? { bg: colors.warnTint, fg: colors.warn }
        : { bg: colors.dangerTint, fg: colors.danger };
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]}>
      <Text style={{ color: palette.fg, ...type.small, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...type.title, color: colors.ink },
  label: { ...type.label, color: colors.muted },
  muted: { ...type.small, color: colors.muted, lineHeight: 19 },
  button: {
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  buttonLabel: { ...type.heading },
  input: {
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  notice: { borderRadius: radius.md, padding: spacing.md },
});
