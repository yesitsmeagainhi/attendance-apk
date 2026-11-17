import { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { api, ApiError } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { Button, Notice } from "../src/components/ui";
import { colors, radius, spacing, type } from "../src/theme";
import { s } from "../src/lib/responsive";
import { API_BASE_URL, IS_PRODUCTION_TARGET } from "../src/config";
import { useKeyboardReveal } from "../src/lib/useKeyboardReveal";

const OTP_LENGTH = 6;

/**
 * Employees sign in by OTP. There is no SMS gateway — an admin reads the
 * pending request off their dashboard and passes the code on — so the copy
 * says "your admin will share the code" rather than "check your messages".
 */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"mobile" | "otp">("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [employee, setEmployee] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const otpRef = useRef<TextInput>(null);
  const mobileDigits = mobile.replace(/\D/g, "");
  // Keep the field being typed in (and its button) just above the keyboard
  const { scrollRef, onScroll, reveal } = useKeyboardReveal();
  const mobileBlockRef = useRef<View>(null);
  const otpBlockRef = useRef<View>(null);

  async function onRequestOtp() {
    setError(null);
    if (mobileDigits.length < 10) {
      setError("Enter the 10-digit mobile number registered with your admin.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.requestOtp(mobileDigits);
      setEmployee({ id: res.employeeId, name: res.employeeName });
      setOtp("");
      setStep("otp");
      setTimeout(() => otpRef.current?.focus(), 250);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(code = otp) {
    if (!employee || busy) return;
    setError(null);
    if (code.length !== OTP_LENGTH) {
      setError("The code is 6 digits.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.verifyOtp(employee.id, code);
      await signIn({ token: res.token, name: res.name, employeeId: res.employeeId });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  // Sign in as soon as the sixth digit is typed
  useEffect(() => {
    if (step === "otp" && otp.length === OTP_LENGTH) onVerify(otp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step]);

  function backToMobile() {
    setStep("mobile");
    setOtp("");
    setError(null);
  }

  const firstName = employee?.name?.split(" ")[0] ?? "";

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* Android is edge-to-edge, so the window no longer resizes for the
          keyboard on its own: pad on both platforms, then lift the field. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={32}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* Brand header */}
          <View style={[styles.hero, { paddingTop: insets.top + spacing.xxl }]}>
            <View style={styles.ring1} />
            <View style={styles.ring2} />
            <View style={styles.logoTile}>
              <Image source={require("../assets/app-icon.jpg")} style={styles.logo} />
            </View>
            <Text style={styles.brandName}>ASM Vikas</Text>
            <Text style={styles.brandSub}>Attendance · Payslips · Requests</Text>
          </View>

          {/* Form sheet */}
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
            <View style={styles.steps}>
              <View style={[styles.stepBar, styles.stepBarOn]} />
              <View style={[styles.stepBar, step === "otp" && styles.stepBarOn]} />
            </View>
            <Text style={styles.stepText}>Step {step === "mobile" ? 1 : 2} of 2</Text>

            {step === "mobile" ? (
              <>
                <Text style={styles.headline}>Sign in</Text>
                <Text style={styles.sub}>Enter the mobile number registered with your administrator.</Text>

                <View ref={mobileBlockRef} collapsable={false} style={styles.block}>
                <Text style={styles.fieldLabel}>MOBILE NUMBER</Text>
                <View style={[styles.phoneBox, error ? styles.boxError : null]}>
                  <Text style={styles.prefix}>+91</Text>
                  <View style={styles.prefixRule} />
                  <TextInput
                    value={mobile}
                    onChangeText={(t) => {
                      setMobile(t.replace(/\D/g, "").slice(0, 10));
                      if (error) setError(null);
                    }}
                    keyboardType="number-pad"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                    maxLength={10}
                    placeholder="98765 43210"
                    placeholderTextColor={colors.muted}
                    editable={!busy}
                    returnKeyType="done"
                    onSubmitEditing={onRequestOtp}
                    onFocus={() => reveal(mobileBlockRef.current)}
                    style={styles.phoneInput}
                    accessibilityLabel="Mobile number"
                  />
                  {mobileDigits.length === 10 ? (
                    <Ionicons name="checkmark-circle" size={s(20)} color={colors.ok} />
                  ) : null}
                </View>

                {error ? <Notice>{error}</Notice> : null}
                <Button label="Get sign-in code" onPress={onRequestOtp} busy={busy} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.headline}>Welcome{firstName ? `, ${firstName}` : ""}</Text>
                <Text style={styles.sub}>
                  Your admin will share a 6-digit code with you. It expires in 5 minutes.
                </Text>

                <View style={styles.numberRow}>
                  <Ionicons name="call-outline" size={s(16)} color={colors.inkSoft} />
                  <Text style={styles.numberText}>+91 {formatMobile(mobileDigits)}</Text>
                  <Pressable onPress={backToMobile} disabled={busy} hitSlop={10} accessibilityRole="button">
                    <Text style={styles.change}>Change</Text>
                  </Pressable>
                </View>

                <View ref={otpBlockRef} collapsable={false} style={styles.block}>
                <Text style={styles.fieldLabel}>6-DIGIT CODE</Text>
                <Pressable onPress={() => otpRef.current?.focus()} style={styles.otpRow} accessibilityRole="none">
                  {Array.from({ length: OTP_LENGTH }).map((_, i) => {
                    const ch = otp[i];
                    const active = i === Math.min(otp.length, OTP_LENGTH - 1) && !busy;
                    return (
                      <View
                        key={i}
                        style={[
                          styles.otpBox,
                          ch ? styles.otpBoxFilled : null,
                          active ? styles.otpBoxActive : null,
                          error ? styles.boxError : null,
                        ]}
                      >
                        <Text style={styles.otpDigit}>{ch ?? ""}</Text>
                      </View>
                    );
                  })}
                  {/* One real input under the boxes keeps paste and autofill working */}
                  <TextInput
                    ref={otpRef}
                    value={otp}
                    onChangeText={(t) => {
                      setOtp(t.replace(/\D/g, "").slice(0, OTP_LENGTH));
                      if (error) setError(null);
                    }}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={OTP_LENGTH}
                    editable={!busy}
                    onFocus={() => reveal(otpBlockRef.current)}
                    caretHidden
                    style={styles.otpHidden}
                    accessibilityLabel="6-digit code"
                  />
                </Pressable>

                {error ? <Notice>{error}</Notice> : null}
                <Button label="Verify and sign in" onPress={() => onVerify()} busy={busy} />
                </View>
                <Pressable
                  onPress={onRequestOtp}
                  disabled={busy}
                  hitSlop={8}
                  style={styles.resend}
                  accessibilityRole="button"
                >
                  <Text style={styles.resendText}>Didn&apos;t get a code? Request a new one</Text>
                </Pressable>
              </>
            )}

            <View style={styles.footer}>
              <View style={styles.footNote}>
                <Ionicons name="shield-checkmark-outline" size={s(16)} color={colors.muted} />
                <Text style={styles.footText}>
                  One device at a time: signing in here signs you out of ASM Vikas in your browser.
                </Text>
              </View>
              {!IS_PRODUCTION_TARGET ? <Text style={styles.target}>Dev server · {API_BASE_URL}</Text> : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** "9876543210" -> "98765 43210" */
function formatMobile(d: string) {
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand },

  hero: {
    alignItems: "center",
    paddingBottom: s(56),
    overflow: "hidden",
  },
  // Soft decorative rings behind the logo
  ring1: {
    position: "absolute", width: s(320), height: s(320), borderRadius: s(160),
    borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", top: -s(60), right: -s(110),
  },
  ring2: {
    position: "absolute", width: s(220), height: s(220), borderRadius: s(110),
    backgroundColor: "rgba(45,139,122,0.18)", bottom: -s(90), left: -s(70),
  },
  logoTile: {
    width: s(88), height: s(88), borderRadius: s(24),
    backgroundColor: colors.white, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 10,
  },
  logo: { width: s(88), height: s(88) },
  brandName: { ...type.display, color: colors.white },
  brandSub: { ...type.small, color: colors.brandBorder, marginTop: spacing.xs, letterSpacing: 0.4 },

  sheet: {
    flex: 1,
    backgroundColor: colors.card,
    borderTopLeftRadius: s(28),
    borderTopRightRadius: s(28),
    marginTop: -s(28),
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  steps: { flexDirection: "row", gap: spacing.xs },
  stepBar: { flex: 1, height: s(4), borderRadius: 2, backgroundColor: colors.rule },
  stepBarOn: { backgroundColor: colors.accent },
  stepText: { ...type.label, color: colors.muted, marginTop: -spacing.xs },

  headline: { ...type.title, fontSize: s(24), color: colors.ink, marginTop: spacing.sm },
  sub: { ...type.body, color: colors.inkSoft, lineHeight: s(22), marginTop: -spacing.xs },

  // Field + its button, lifted together above the keyboard (same gap as the sheet)
  block: { gap: spacing.md },
  fieldLabel: { ...type.label, color: colors.inkSoft, marginTop: spacing.sm },
  phoneBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.rule,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    minHeight: s(54),
    gap: spacing.md,
  },
  prefix: { ...type.heading, color: colors.ink },
  prefixRule: { width: 1, alignSelf: "stretch", marginVertical: s(12), backgroundColor: colors.rule },
  phoneInput: {
    flex: 1,
    fontSize: s(17),
    fontWeight: "600",
    color: colors.ink,
    letterSpacing: 1,
    paddingVertical: s(12),
  },
  boxError: { borderColor: colors.danger },

  numberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: s(10),
  },
  numberText: { ...type.body, color: colors.ink, fontWeight: "600", flex: 1, fontVariant: ["tabular-nums"] },
  change: { ...type.small, color: colors.brand, fontWeight: "700" },

  otpRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  otpBox: {
    flex: 1,
    aspectRatio: 0.85,
    maxHeight: s(60),
    borderWidth: 1.5,
    borderColor: colors.rule,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  otpBoxFilled: { backgroundColor: colors.card, borderColor: colors.brandBorder },
  otpBoxActive: { borderColor: colors.brand, borderWidth: 2 },
  otpDigit: { fontSize: s(22), fontWeight: "700", color: colors.ink, fontVariant: ["tabular-nums"] },
  otpHidden: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.01, color: "transparent" },

  resend: { alignSelf: "center", paddingVertical: spacing.xs },
  resendText: { ...type.small, color: colors.brand, fontWeight: "600" },

  footer: { marginTop: "auto", paddingTop: spacing.xl, gap: spacing.sm },
  footNote: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  footText: { ...type.small, color: colors.muted, lineHeight: s(19), flex: 1 },
  target: { ...type.small, color: colors.warn, fontSize: s(11) },
});
