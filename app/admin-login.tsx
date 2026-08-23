import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, ApiError } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { Button, Card, Field, Muted, Notice } from "../src/components/ui";
import { colors, radius, spacing, type } from "../src/theme";
import { API_BASE_URL, IS_PRODUCTION_TARGET } from "../src/config";

/**
 * Admin sign-in, reached by tapping the logo on the employee login screen.
 *
 * This posts to `/api/auth/login`, the same email + password endpoint the web
 * dashboard uses, so the token it returns carries whatever role the server
 * assigns that account. The employee OTP flow cannot produce an admin token —
 * `verify-otp` issues employee sessions — which is why this is a separate door
 * rather than a branch of the same form.
 *
 * The password is never stored: only the returned token goes to SecureStore,
 * exactly as it does for an employee sign-in.
 */
export default function AdminLoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter the email and password for your admin account.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.adminLogin(email.trim(), password);
      const token = res.token ?? res.user?.token;
      if (!token) {
        setError("The server signed you in but returned no token. Tell your developer.");
        return;
      }
      setPassword("");
      await signIn({
        token,
        name: res.name ?? res.user?.name ?? email.trim(),
        employeeId: res.employeeId ?? res.user?.id ?? "",
        role: res.role ?? res.user?.role ?? "",
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't sign you in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back to employee sign in"
            style={styles.back}
          >
            <Ionicons name="arrow-back" size={24} color={colors.ink} />
          </Pressable>

          <View style={styles.brandRow}>
            <View style={styles.mark}>
              <Ionicons name="shield-checkmark" size={24} color={colors.white} />
            </View>
            <Text style={styles.brandName}>Admin</Text>
          </View>

          <Text style={styles.headline}>Sign in as administrator</Text>
          <Muted>Use the same email and password you use on the Attendly dashboard.</Muted>

          <Card style={{ marginTop: spacing.xl }}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              placeholder="admin@example.com"
              editable={!busy}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              placeholder="••••••••"
              editable={!busy}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
            <Pressable
              onPress={() => setReveal((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              style={styles.revealRow}
            >
              <Ionicons
                name={reveal ? "eye-off-outline" : "eye-outline"}
                size={16}
                color={colors.brand}
              />
              <Text style={styles.revealText}>{reveal ? "Hide password" : "Show password"}</Text>
            </Pressable>

            {error ? <Notice>{error}</Notice> : null}
            <Button label="Sign in" onPress={onSubmit} busy={busy} />
          </Card>

          <View style={styles.footer}>
            <Muted>
              Signing in here signs you out of the Attendly dashboard in your browser — an
              account can only be active on one device at a time.
            </Muted>
            <Text style={styles.target}>
              {IS_PRODUCTION_TARGET ? "Server" : "Dev server"} · {API_BASE_URL}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingTop: spacing.lg, flexGrow: 1 },
  back: { alignSelf: "flex-start", marginBottom: spacing.lg },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  mark: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { ...type.title, color: colors.ink, fontSize: 24 },
  headline: { ...type.display, color: colors.ink, marginBottom: spacing.sm },
  revealRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  revealText: { ...type.small, color: colors.brand, fontWeight: "600" },
  footer: { marginTop: "auto", paddingTop: spacing.xxl, gap: spacing.sm },
  target: { ...type.small, color: colors.muted, fontSize: 11 },
});
