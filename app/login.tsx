import { useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { Button, Card, Field, Muted, Notice } from "../src/components/ui";
import { colors, radius, spacing, type } from "../src/theme";
import { s } from "../src/lib/responsive";
import { API_BASE_URL, IS_PRODUCTION_TARGET } from "../src/config";

/**
 * Employees sign in by OTP. There is no SMS gateway — an admin reads the
 * pending request off their dashboard and passes the code on — so the copy
 * says "your admin will share the code" rather than "check your messages".
 */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [step, setStep] = useState<"mobile" | "otp">("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [employee, setEmployee] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const otpRef = useRef<any>(null);

  async function onRequestOtp() {
    setError(null);
    const digits = mobile.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Enter the 10-digit mobile number registered with your admin.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.requestOtp(digits);
      setEmployee({ id: res.employeeId, name: res.employeeName });
      setStep("otp");
      setTimeout(() => otpRef.current?.focus?.(), 250);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    if (!employee) return;
    setError(null);
    if (otp.trim().length !== 6) {
      setError("The code is 6 digits.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.verifyOtp(employee.id, otp.trim());
      await signIn({ token: res.token, name: res.name, employeeId: res.employeeId });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
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
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero — centered logo + brand name */}
          <View style={styles.hero}>
            <View style={styles.logoWrap}>
              <Image source={require("../assets/app-icon.jpg")} style={styles.mark} />
            </View>
            <Text style={styles.brandName}>ASM Vikas</Text>
            <Text style={styles.brandSub}>Attendance Management</Text>
          </View>

          {/* Step heading */}
          <Text style={styles.headline}>
            {step === "mobile" ? "Sign in to your account" : `Welcome, ${employee?.name ?? ""}`}
          </Text>
          <Muted>
            {step === "mobile"
              ? "Enter the mobile number registered with your administrator."
              : "Your admin will share a 6-digit code. It expires in 5 minutes."}
          </Muted>

          <Card style={{ marginTop: spacing.xl }}>
            {step === "mobile" ? (
              <>
                <Field
                  label="Mobile number"
                  value={mobile}
                  onChangeText={setMobile}
                  keyboardType="number-pad"
                  autoComplete="tel"
                  maxLength={15}
                  placeholder="9800000001"
                  editable={!busy}
                />
                {error ? <Notice>{error}</Notice> : null}
                <Button label="Request code" onPress={onRequestOtp} busy={busy} />
              </>
            ) : (
              <>
                <Field
                  label="6-digit code"
                  value={otp}
                  onChangeText={(t) => setOtp(t.replace(/\D/g, ""))}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="------"
                  editable={!busy}
                />
                {error ? <Notice>{error}</Notice> : null}
                <Button label="Verify and sign in" onPress={onVerify} busy={busy} />
                <Button
                  label="Use a different number"
                  variant="secondary"
                  onPress={() => {
                    setStep("mobile");
                    setOtp("");
                    setError(null);
                  }}
                  disabled={busy}
                />
              </>
            )}
          </Card>

          <View style={styles.footer}>
            <Muted>
              Signing in here signs you out of ASM Vikas in your browser — an account can
              only be active on one device at a time.
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
  hero: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
  },
  logoWrap: {
    borderRadius: radius.lg,
    overflow: "hidden",
    shadowColor: "#1A2D62",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: spacing.lg,
  },
  mark: {
    width: s(80),
    height: s(80),
  },
  brandName: {
    ...type.display,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  brandSub: {
    ...type.small,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  headline: { ...type.title, color: colors.ink, marginBottom: spacing.sm },
  footer: { marginTop: "auto", paddingTop: spacing.xxl, gap: spacing.sm },
  target: { ...type.small, color: colors.muted, fontSize: s(11) },
});
