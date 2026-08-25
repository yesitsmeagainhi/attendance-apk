import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCameraDevice, useCameraPermission } from "react-native-vision-camera";
import { Camera, Face } from "react-native-vision-camera-face-detector";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, ApiError } from "../src/api/client";
import { acquireLocation, compressPhoto, PunchPrepError } from "../src/lib/punch";
import { s, useResponsive } from "../src/lib/responsive";
import { Button, Notice } from "../src/components/ui";
import { colors, radius, spacing, type as typo } from "../src/theme";

type LocState =
  | { kind: "pending" }
  | { kind: "ready"; latitude: number; longitude: number }
  | { kind: "failed"; message: string };

type Phase = "capture" | "review" | "done";

/**
 * Punch capture with real-time face detection.
 *
 * Flow: camera opens with face guide → face detection runs continuously →
 * shutter enables when a face is detected → user captures → review → submit.
 *
 * GPS acquisition starts on mount, in parallel with the camera, because the
 * server rejects any punch without coordinates and a cold fix can take 10-20s.
 */
export default function PunchScreen() {
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type: "IN" | "OUT" }>();
  const punchType: "IN" | "OUT" = type === "OUT" ? "OUT" : "IN";
  const actionLabel = punchType === "IN" ? "punch in" : "punch out";

  // ── Responsive sizing ────────────────────────────────────────────────
  const { wp, scale } = useResponsive();
  const guideWidth = wp(65);
  const guideHeight = guideWidth * 1.28;
  const guideBorderRadius = guideWidth * 0.56;
  const shutterSize = Math.min(Math.max(wp(20), 64), 90);
  const shutterInnerSize = shutterSize * 0.77;
  const iconSize = scale(28);
  const titleFontSize = scale(17);

  // ── Camera & face detection ──────────────────────────────────────────
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("front");
  const cameraRef = useRef<any>(null);
  const [faceDetected, setFaceDetected] = useState(false);

  const handleFacesDetected = useCallback((faces: Face[]) => {
    setFaceDetected(faces.length > 0);
  }, []);

  // ── Location, phase, UI state ────────────────────────────────────────
  const [loc, setLoc] = useState<LocState>({ kind: "pending" });
  const [phase, setPhase] = useState<Phase>("capture");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoAlert, setGeoAlert] = useState<ApiError["geoAlert"]>(null);

  const refreshLocation = useCallback(async () => {
    setLoc({ kind: "pending" });
    setError(null);
    try {
      const fix = await acquireLocation();
      setLoc({ kind: "ready", ...fix });
    } catch (e) {
      setLoc({
        kind: "failed",
        message: e instanceof PunchPrepError ? e.message : "Couldn't determine your location.",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fix = await acquireLocation();
        if (!cancelled) setLoc({ kind: "ready", ...fix });
      } catch (e) {
        if (!cancelled) {
          setLoc({
            kind: "failed",
            message: e instanceof PunchPrepError ? e.message : "Couldn't determine your location.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Capture ──────────────────────────────────────────────────────────
  async function onCapture() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const shot = await cameraRef.current?.takePhoto({ flash: "off" });
      if (!shot?.path) throw new Error("capture failed");
      const compressed = await compressPhoto(`file://${shot.path}`);
      setPhotoUri(compressed);
      setPhase("review");
    } catch {
      setError("Couldn't take the photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (loc.kind !== "ready" || !photoUri || busy) return;
    setError(null);
    setGeoAlert(null);
    setBusy(true);
    try {
      await api.punch({
        photoUri,
        punchType,
        latitude: loc.latitude,
        longitude: loc.longitude,
      });
      setPhase("done");
      setTimeout(() => router.back(), 1100);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setGeoAlert(e.geoAlert ?? null);
      } else {
        setError("Couldn't record your punch. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  function onRetake() {
    setPhotoUri(null);
    setError(null);
    setGeoAlert(null);
    setFaceDetected(false);
    setPhase("capture");
  }

  // ── Permission states ────────────────────────────────────────────────
  if (hasPermission === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.permission}>
        <Ionicons name="camera-outline" size={s(44)} color={colors.brand} />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>
          ASM Vikas records a selfie with every punch so your attendance can be verified.
        </Text>
        <Button label="Allow camera" onPress={requestPermission} />
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.permission}>
        <Ionicons name="warning-outline" size={s(44)} color={colors.warn} />
        <Text style={styles.permTitle}>No front camera</Text>
        <Text style={styles.permBody}>
          A front-facing camera is required to take your attendance selfie.
        </Text>
        <Button label="Go back" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  // ── Guide border color based on face detection ───────────────────────
  const guideBorder = faceDetected
    ? "rgba(21,128,61,0.85)"
    : "rgba(255,255,255,0.55)";

  const canCapture = faceDetected && !busy;

  return (
    <View style={styles.root}>
      {phase === "capture" ? (
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={phase === "capture"}
          photo
          performanceMode="fast"
          onFacesDetected={handleFacesDetected}
        />
      ) : photoUri ? (
        <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}

      <SafeAreaView style={styles.overlay}>
        {/* ── Top bar ──────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          <Pressable
            onPress={() => (phase === "review" ? onRetake() : router.back())}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={phase === "review" ? "Back to camera" : "Close"}
          >
            <Ionicons
              name={phase === "review" ? "arrow-back" : "close"}
              size={iconSize}
              color={colors.white}
            />
          </Pressable>
          <Text style={[styles.topTitle, { fontSize: titleFontSize }]}>
            {phase === "review" ? "Check your photo" : punchType === "IN" ? "Punch in" : "Punch out"}
          </Text>
          <View style={{ width: iconSize }} />
        </View>

        {/* ── Face guide oval + detection indicator ────────────────── */}
        {phase === "capture" ? (
          <View style={styles.guideArea}>
            <View
              style={{
                width: guideWidth,
                height: guideHeight,
                borderRadius: guideBorderRadius,
                borderWidth: 3,
                borderColor: guideBorder,
              }}
              pointerEvents="none"
            />
            <View style={styles.faceChip}>
              <Ionicons
                name={faceDetected ? "checkmark-circle" : "scan-outline"}
                size={16}
                color={faceDetected ? colors.ok : colors.white}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: faceDetected ? colors.ok : colors.white },
                ]}
              >
                {faceDetected ? "Face detected" : "Position your face in the oval"}
              </Text>
            </View>
          </View>
        ) : (
          <View />
        )}

        {/* ── Bottom controls ──────────────────────────────────────── */}
        <View style={styles.bottom}>
          {phase === "done" ? (
            <View style={styles.statusChip}>
              <Ionicons name="checkmark-circle" size={18} color={colors.ok} />
              <Text style={[styles.statusText, { color: colors.ok }]}>
                Punched {punchType === "IN" ? "in" : "out"}
              </Text>
            </View>
          ) : (
            <LocationRow state={loc} onRefresh={refreshLocation} />
          )}

          {loc.kind === "failed" && phase !== "done" ? (
            <View style={styles.wide}>
              <Notice>{loc.message}</Notice>
            </View>
          ) : null}

          {error ? (
            <View style={styles.wide}>
              <Notice>
                {error}
                {geoAlert
                  ? `\n\nNearest office: ${geoAlert.branchName} — you are ${geoAlert.distance}m away, and the limit is ${geoAlert.allowedRadius}m.`
                  : ""}
              </Notice>
            </View>
          ) : null}

          {phase === "capture" ? (
            <Pressable
              onPress={onCapture}
              disabled={!canCapture}
              accessibilityRole="button"
              accessibilityLabel={`Take your ${actionLabel} photo`}
              style={({ pressed }) => [
                {
                  width: shutterSize,
                  height: shutterSize,
                  borderRadius: radius.pill,
                  backgroundColor: colors.white,
                  alignItems: "center" as const,
                  justifyContent: "center" as const,
                  borderWidth: 4,
                  borderColor: "rgba(255,255,255,0.4)",
                  opacity: !canCapture ? 0.45 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <View
                  style={{
                    width: shutterInnerSize,
                    height: shutterInnerSize,
                    borderRadius: radius.pill,
                    backgroundColor: colors.brand,
                  }}
                />
              )}
            </Pressable>
          ) : phase === "review" ? (
            <View style={styles.reviewActions}>
              <View style={styles.reviewButton}>
                <Button label="Retake" variant="secondary" onPress={onRetake} disabled={busy} />
              </View>
              <View style={styles.reviewButton}>
                <Button
                  label={punchType === "IN" ? "Submit punch in" : "Submit punch out"}
                  onPress={onSubmit}
                  busy={busy}
                  disabled={loc.kind !== "ready"}
                />
              </View>
            </View>
          ) : null}

          {phase === "review" && loc.kind !== "ready" ? (
            <Text style={styles.hint}>Waiting for your location before this can be submitted.</Text>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

function LocationRow({ state, onRefresh }: { state: LocState; onRefresh: () => void }) {
  const pending = state.kind === "pending";
  return (
    <View style={styles.locRow}>
      <View style={styles.statusChip}>
        {pending ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <Ionicons
            name={state.kind === "ready" ? "location" : "location-outline"}
            size={16}
            color={state.kind === "ready" ? colors.white : colors.danger}
          />
        )}
        <Text style={styles.statusText}>
          {pending
            ? "Finding your location\u2026"
            : state.kind === "ready"
              ? "Location ready"
              : "Location unavailable"}
        </Text>
      </View>

      <Pressable
        onPress={onRefresh}
        disabled={pending}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Refresh location"
        style={({ pressed }) => [
          styles.refreshBtn,
          { opacity: pending ? 0.45 : pressed ? 0.7 : 1 },
        ]}
      >
        <Ionicons name="refresh" size={15} color={colors.white} />
        <Text style={styles.refreshText}>Refresh</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  overlay: { flex: 1, justifyContent: "space-between" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  topTitle: { ...typo.heading, color: colors.white },
  guideArea: {
    alignItems: "center",
    gap: spacing.md,
  },
  faceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  bottom: {
    alignItems: "center",
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  wide: { alignSelf: "stretch" },
  locRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  statusText: { ...typo.small, color: colors.white, fontWeight: "600" },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(5),
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  refreshText: { ...typo.small, color: colors.white, fontWeight: "600", fontSize: s(12) },
  reviewActions: { flexDirection: "row", gap: spacing.md, alignSelf: "stretch" },
  reviewButton: { flex: 1 },
  hint: { ...typo.small, color: colors.white, opacity: 0.75, textAlign: "center" },
  permission: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xl,
    justifyContent: "center",
    gap: spacing.md,
  },
  permTitle: { ...typo.title, color: colors.ink },
  permBody: { ...typo.body, color: colors.inkSoft, lineHeight: s(21), marginBottom: spacing.sm },
});
