// import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
// import { SafeAreaView } from "react-native-safe-area-context";
// import {
//   Camera,
//   useCameraDevice,
//   useCameraPermission,
//   usePhotoOutput,
// } from "react-native-vision-camera";
// import { createFaceDetectorOutput } from "react-native-vision-camera-face-detector";
// import { Ionicons } from "@expo/vector-icons";
// import { useLocalSearchParams, useRouter } from "expo-router";
// import { api, ApiError } from "../src/api/client";
// import { acquireLocation, compressPhoto, PunchPrepError } from "../src/lib/punch";
// import { Button, Notice } from "../src/components/ui";
// import { colors, radius, spacing, type } from "../src/theme";

// type LocState =
//   | { kind: "pending" }
//   | { kind: "ready"; latitude: number; longitude: number }
//   | { kind: "failed"; message: string };

// type Phase = "capture" | "review" | "done";

// /**
//  * Punch capture, in two steps: frame and shoot, then confirm before it is
//  * recorded. A punch is not editable afterwards, so the review step exists to
//  * stop a bad frame becoming a permanent attendance record.
//  *
//  * GPS acquisition starts on mount, in parallel with the camera warming up,
//  * because the server rejects any punch without coordinates and a cold fix can
//  * take 10-20s.
//  *
//  * Face detection is handled by useFaceDetectorOutput which runs on every
//  * camera frame and calls onFacesDetected on the JS thread — no manual worklet
//  * bridge required. The guide oval turns green when a face is in frame.
//  */
// export default function PunchScreen() {
//   const router = useRouter();
//   const { type } = useLocalSearchParams<{ type: "IN" | "OUT" }>();
//   const punchType: "IN" | "OUT" = type === "OUT" ? "OUT" : "IN";
//   const actionLabel = punchType === "IN" ? "punch in" : "punch out";

//   const { hasPermission, requestPermission } = useCameraPermission();
//   const device = useCameraDevice("front");

//   const [loc, setLoc] = useState<LocState>({ kind: "pending" });
//   const [phase, setPhase] = useState<Phase>("capture");
//   const [photoUri, setPhotoUri] = useState<string | null>(null);
//   const [busy, setBusy] = useState(false);
//   const [error, setError] = useState<string | null>(null);
//   const [geoAlert, setGeoAlert] = useState<ApiError["geoAlert"]>(null);
//   const [faceDetected, setFaceDetected] = useState(false);
//   const [cameraReady, setCameraReady] = useState(false);
//   // Ref version of faceDetected to skip no-op state updates (stable, no deps).
//   const faceDetectedRef = useRef(false);
//   // Set to true during capture so no re-renders occur that could change the
//   // outputs array and trigger a camera session reconfigure → "Camera is closed".
//   const capturingRef = useRef(false);

//   // Photo output — stable across renders (usePhotoOutput uses useMemo internally).
//   const photoOutput = usePhotoOutput();

//   // Face detection output created ONCE via useMemo([]) — bypasses the
//   // useFaceDetectorOutput bug where its internal useMemo depends on `...options`
//   // (always a new {} object), recreating the native output every render and
//   // forcing camera session reconfiguration on every render.
//   // All captured refs (capturingRef, faceDetectedRef, setFaceDetected) are stable.
//   const faceOutput = useMemo(
//     () =>
//       createFaceDetectorOutput({
//         onFacesDetected: (faces) => {
//           if (capturingRef.current) return;
//           const detected = faces.length > 0;
//           if (faceDetectedRef.current !== detected) {
//             faceDetectedRef.current = detected;
//             setFaceDetected(detected);
//           }
//         },
//         onError: (_e) => {},
//       }),
//     [],
//   );

//   // Stable outputs array — both objects are stable so this never changes.
//   const outputs = useMemo(() => [photoOutput, faceOutput], [photoOutput, faceOutput]);

//   const refreshLocation = useCallback(async () => {
//     setLoc({ kind: "pending" });
//     setError(null);
//     try {
//       const fix = await acquireLocation();
//       setLoc({ kind: "ready", ...fix });
//     } catch (e) {
//       setLoc({
//         kind: "failed",
//         message: e instanceof PunchPrepError ? e.message : "Couldn't determine your location.",
//       });
//     }
//   }, []);

//   useEffect(() => {
//     let cancelled = false;
//     (async () => {
//       try {
//         const fix = await acquireLocation();
//         if (!cancelled) setLoc({ kind: "ready", ...fix });
//       } catch (e) {
//         if (!cancelled) {
//           setLoc({
//             kind: "failed",
//             message: e instanceof PunchPrepError ? e.message : "Couldn't determine your location.",
//           });
//         }
//       }
//     })();
//     return () => {
//       cancelled = true;
//     };
//   }, []);

//   async function onCapture() {
//     if (busy || !cameraReady) return;
//     setError(null);
//     setBusy(true);
//     capturingRef.current = true; // block face-detector state updates during capture
//     try {
//       // capturePhotoToFile writes directly to a temp file; filePath is a bare
//       // filesystem path (no file:// prefix) — add it for the image manipulator.
//       const file = await photoOutput.capturePhotoToFile({}, {});
//       const compressed = await compressPhoto(`file://${file.filePath}`);
//       setPhotoUri(compressed);
//       setPhase("review");
//     } catch (e) {
//       const msg = e instanceof Error ? e.message : String(e);
//       console.error("[punch] capture failed:", e);
//       setError(`Couldn't take the photo.\n${msg}`);
//     } finally {
//       capturingRef.current = false;
//       setBusy(false);
//     }
//   }

//   async function onSubmit() {
//     if (loc.kind !== "ready" || !photoUri || busy) return;
//     setError(null);
//     setGeoAlert(null);
//     setBusy(true);
//     try {
//       await api.punch({
//         photoUri,
//         punchType,
//         latitude: loc.latitude,
//         longitude: loc.longitude,
//       });
//       setPhase("done");
//       setTimeout(() => router.back(), 1100);
//     } catch (e) {
//       if (e instanceof ApiError) {
//         setError(e.message);
//         setGeoAlert(e.geoAlert ?? null);
//       } else {
//         setError("Couldn't record your punch. Try again.");
//       }
//     } finally {
//       setBusy(false);
//     }
//   }

//   function onRetake() {
//     setPhotoUri(null);
//     setError(null);
//     setGeoAlert(null);
//     setPhase("capture");
//     setFaceDetected(false);
//   }

//   if (!hasPermission) {
//     return (
//       <SafeAreaView style={styles.permission}>
//         <Ionicons name="camera-outline" size={44} color={colors.brand} />
//         <Text style={styles.permTitle}>Camera access needed</Text>
//         <Text style={styles.permBody}>
//           Attendly records a selfie with every punch so your attendance can be verified.
//         </Text>
//         <Button label="Allow camera" onPress={requestPermission} />
//         <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
//       </SafeAreaView>
//     );
//   }

//   if (!device) {
//     return (
//       <View style={styles.centered}>
//         <ActivityIndicator color={colors.brand} />
//       </View>
//     );
//   }

//   return (
//     <View style={styles.root}>
//       {phase === "capture" ? (
//         <Camera
//           style={StyleSheet.absoluteFill}
//           device={device}
//           isActive
//           outputs={outputs}
//           onPreviewStarted={() => setCameraReady(true)}
//           onPreviewStopped={() => setCameraReady(false)}
//         />
//       ) : photoUri ? (
//         <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
//       ) : null}

//       <SafeAreaView style={styles.overlay}>
//         {/* Top bar */}
//         <View style={styles.topBar}>
//           <Pressable
//             onPress={() => (phase === "review" ? onRetake() : router.back())}
//             hitSlop={12}
//             accessibilityRole="button"
//             accessibilityLabel={phase === "review" ? "Back to camera" : "Close"}
//           >
//             <Ionicons
//               name={phase === "review" ? "arrow-back" : "close"}
//               size={28}
//               color={colors.white}
//             />
//           </Pressable>
//           <Text style={styles.topTitle}>
//             {phase === "review"
//               ? "Check your photo"
//               : punchType === "IN"
//                 ? "Punch in"
//                 : "Punch out"}
//           </Text>
//           <View style={{ width: 28 }} />
//         </View>

//         {/* Face guide oval — turns green when a face is detected */}
//         {phase === "capture" ? (
//           <View
//             style={[styles.guide, faceDetected && styles.guideActive]}
//             pointerEvents="none"
//           />
//         ) : (
//           <View />
//         )}

//         {/* Bottom controls */}
//         <View style={styles.bottom}>
//           {phase === "done" ? (
//             <View style={styles.statusChip}>
//               <Ionicons name="checkmark-circle" size={18} color={colors.ok} />
//               <Text style={[styles.statusText, { color: colors.ok }]}>
//                 Punched {punchType === "IN" ? "in" : "out"}
//               </Text>
//             </View>
//           ) : (
//             <LocationRow state={loc} onRefresh={refreshLocation} />
//           )}

//           {/* Face detection status chip */}
//           {phase === "capture" && (
//             <View style={styles.statusChip}>
//               <Ionicons
//                 name={faceDetected ? "checkmark-circle" : "scan-outline"}
//                 size={16}
//                 color={faceDetected ? colors.ok : colors.white}
//               />
//               <Text style={styles.statusText}>
//                 {faceDetected ? "Face detected" : "Position your face in the frame"}
//               </Text>
//             </View>
//           )}

//           {loc.kind === "failed" && phase !== "done" ? (
//             <View style={styles.wide}>
//               <Notice>{loc.message}</Notice>
//             </View>
//           ) : null}

//           {error ? (
//             <View style={styles.wide}>
//               <Notice>
//                 {error}
//                 {geoAlert
//                   ? `\n\nNearest office: ${geoAlert.branchName} — you are ${geoAlert.distance}m away, and the limit is ${geoAlert.allowedRadius}m.`
//                   : ""}
//               </Notice>
//             </View>
//           ) : null}

//           {phase === "capture" ? (
//             <Pressable
//               onPress={onCapture}
//               disabled={busy || !cameraReady}
//               accessibilityRole="button"
//               accessibilityLabel={`Take your ${actionLabel} photo`}
//               style={({ pressed }) => [
//                 styles.shutter,
//                 { opacity: busy ? 0.5 : pressed ? 0.85 : 1 },
//               ]}
//             >
//               {busy ? (
//                 <ActivityIndicator color={colors.brand} />
//               ) : (
//                 <View style={styles.shutterInner} />
//               )}
//             </Pressable>
//           ) : phase === "review" ? (
//             <View style={styles.reviewActions}>
//               <View style={styles.reviewButton}>
//                 <Button label="Retake" variant="secondary" onPress={onRetake} disabled={busy} />
//               </View>
//               <View style={styles.reviewButton}>
//                 <Button
//                   label={punchType === "IN" ? "Submit punch in" : "Submit punch out"}
//                   onPress={onSubmit}
//                   busy={busy}
//                   disabled={loc.kind !== "ready"}
//                 />
//               </View>
//             </View>
//           ) : null}

//           {phase === "review" && loc.kind !== "ready" ? (
//             <Text style={styles.hint}>
//               Waiting for your location before this can be submitted.
//             </Text>
//           ) : null}
//         </View>
//       </SafeAreaView>
//     </View>
//   );
// }

// function LocationRow({ state, onRefresh }: { state: LocState; onRefresh: () => void }) {
//   const pending = state.kind === "pending";
//   return (
//     <View style={styles.locRow}>
//       <View style={styles.statusChip}>
//         {pending ? (
//           <ActivityIndicator size="small" color={colors.white} />
//         ) : (
//           <Ionicons
//             name={state.kind === "ready" ? "location" : "location-outline"}
//             size={16}
//             color={state.kind === "ready" ? colors.white : colors.danger}
//           />
//         )}
//         <Text style={styles.statusText}>
//           {pending
//             ? "Finding your location…"
//             : state.kind === "ready"
//               ? "Location ready"
//               : "Location unavailable"}
//         </Text>
//       </View>

//       <Pressable
//         onPress={onRefresh}
//         disabled={pending}
//         hitSlop={10}
//         accessibilityRole="button"
//         accessibilityLabel="Refresh location"
//         style={({ pressed }) => [
//           styles.refreshBtn,
//           { opacity: pending ? 0.45 : pressed ? 0.7 : 1 },
//         ]}
//       >
//         <Ionicons name="refresh" size={15} color={colors.white} />
//         <Text style={styles.refreshText}>Refresh</Text>
//       </Pressable>
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   root: { flex: 1, backgroundColor: "#000" },
//   centered: {
//     flex: 1,
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: colors.bg,
//   },
//   overlay: { flex: 1, justifyContent: "space-between" },
//   topBar: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     paddingHorizontal: spacing.lg,
//     paddingVertical: spacing.md,
//   },
//   topTitle: { ...type.heading, color: colors.white, fontSize: 17 },
//   guide: {
//     alignSelf: "center",
//     width: 250,
//     height: 320,
//     borderRadius: 140,
//     borderWidth: 3,
//     borderColor: "rgba(255,255,255,0.55)",
//   },
//   guideActive: {
//     borderColor: colors.ok,
//     borderWidth: 4,
//   },
//   bottom: {
//     alignItems: "center",
//     gap: spacing.lg,
//     paddingBottom: spacing.xl,
//     paddingHorizontal: spacing.lg,
//   },
//   wide: { alignSelf: "stretch" },
//   locRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
//   statusChip: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: spacing.sm,
//     backgroundColor: "rgba(0,0,0,0.6)",
//     paddingHorizontal: spacing.lg,
//     paddingVertical: spacing.sm,
//     borderRadius: radius.pill,
//   },
//   statusText: { ...type.small, color: colors.white, fontWeight: "600" },
//   refreshBtn: {
//     flexDirection: "row",
//     alignItems: "center",
//     gap: 5,
//     backgroundColor: "rgba(255,255,255,0.18)",
//     borderWidth: 1,
//     borderColor: "rgba(255,255,255,0.35)",
//     paddingHorizontal: spacing.md,
//     paddingVertical: spacing.sm,
//     borderRadius: radius.pill,
//   },
//   refreshText: { ...type.small, color: colors.white, fontWeight: "600", fontSize: 12 },
//   shutter: {
//     width: 78,
//     height: 78,
//     borderRadius: radius.pill,
//     backgroundColor: colors.white,
//     alignItems: "center",
//     justifyContent: "center",
//     borderWidth: 4,
//     borderColor: "rgba(255,255,255,0.4)",
//   },
//   shutterInner: { width: 60, height: 60, borderRadius: radius.pill, backgroundColor: colors.brand },
//   reviewActions: { flexDirection: "row", gap: spacing.md, alignSelf: "stretch" },
//   reviewButton: { flex: 1 },
//   hint: { ...type.small, color: colors.white, opacity: 0.75, textAlign: "center" },
//   permission: {
//     flex: 1,
//     backgroundColor: colors.bg,
//     padding: spacing.xl,
//     justifyContent: "center",
//     gap: spacing.md,
//   },
//   permTitle: { ...type.title, color: colors.ink },
//   permBody: { ...type.body, color: colors.inkSoft, lineHeight: 21, marginBottom: spacing.sm },
// });


import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, ApiError, Branch } from "../src/api/client";
import { acquireLocation, compressPhoto, PunchPrepError } from "../src/lib/punch";
import { Button, Notice } from "../src/components/ui";
import { colors, radius, spacing, type } from "../src/theme";

type LocState =
  | { kind: "pending" }
  | { kind: "ready"; latitude: number; longitude: number }
  | { kind: "failed"; message: string };

type Phase = "capture" | "review" | "done";

/** Nearest-branch result after client-side distance check. */
type GeoCheck =
  | { inRange: true; branchName: string; distance: number; allowed: number }
  | { inRange: false; branchName: string; distance: number; allowed: number }
  | null; // branches not loaded yet

const AUTO_REFRESH_MS = 10_000; // re-check location every 10s

/**
 * Punch capture, in two steps: frame and shoot, then confirm before it is
 * recorded. A punch is not editable afterwards, so the review step exists to
 * stop a bad frame becoming a permanent attendance record.
 *
 * GPS acquisition starts on mount, in parallel with the camera warming up,
 * because the server rejects any punch without coordinates and a cold fix can
 * take 10-20s.
 */
export default function PunchScreen() {
  const router = useRouter();
  const { type, sessionNumber } = useLocalSearchParams<{ type: "IN" | "OUT"; sessionNumber?: string }>();
  const punchType: "IN" | "OUT" = type === "OUT" ? "OUT" : "IN";
  const sessionNum = sessionNumber ? parseInt(sessionNumber, 10) : undefined;
  const actionLabel = punchType === "IN" ? "punch in" : "punch out";

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [loc, setLoc] = useState<LocState>({ kind: "pending" });
  const [phase, setPhase] = useState<Phase>("capture");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoAlert, setGeoAlert] = useState<ApiError["geoAlert"]>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [geoCheck, setGeoCheck] = useState<GeoCheck>(null);

  // ── Fetch branches on mount ──
  useEffect(() => {
    api.branches().then((r) => setBranches(r.branches)).catch(() => {});
  }, []);

  // ── Recompute distance whenever location or branches change ──
  useEffect(() => {
    if (loc.kind !== "ready" || branches.length === 0) {
      setGeoCheck(null);
      return;
    }
    const nearest = findNearest(loc.latitude, loc.longitude, branches);
    setGeoCheck(nearest);
  }, [loc, branches]);

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

  // ── Initial location fix ──
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
    return () => { cancelled = true; };
  }, []);

  // ── Auto-refresh location every 10s while not done ──
  useEffect(() => {
    if (phase === "done") return;
    const id = setInterval(async () => {
      try {
        const fix = await acquireLocation();
        setLoc({ kind: "ready", ...fix });
      } catch {
        // keep previous location if refresh fails silently
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [phase]);

  const outOfRange = geoCheck !== null && !geoCheck.inRange;

  async function onCapture() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.9, skipProcessing: true });
      if (!shot?.uri) throw new Error("capture failed");
      const compressed = await compressPhoto(shot.uri);
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
        sessionNumber: sessionNum ?? 0,
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
    setPhase("capture");
  }

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permission}>
        <Ionicons name="camera-outline" size={44} color={colors.brand} />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>
          Attendly records a selfie with every punch so your attendance can be verified.
        </Text>
        <Button label="Allow camera" onPress={requestPermission} />
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      {phase === "capture" ? (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
      ) : photoUri ? (
        <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}

      <SafeAreaView style={styles.overlay}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => (phase === "review" ? onRetake() : router.back())}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={phase === "review" ? "Back to camera" : "Close"}
          >
            <Ionicons name={phase === "review" ? "arrow-back" : "close"} size={28} color={colors.white} />
          </Pressable>
          <Text style={styles.topTitle}>
            {phase === "review"
              ? "Check your photo"
              : sessionNum
                ? `Session ${sessionNum} — ${punchType === "IN" ? "Punch in" : "Punch out"}`
                : punchType === "IN"
                  ? "Punch in"
                  : "Punch out"}
          </Text>
          <View style={{ width: 28 }} />
        </View>

        {phase === "capture" ? <View style={styles.guide} pointerEvents="none" /> : <View />}

        <View style={styles.bottom}>
          {phase === "done" ? (
            <View style={styles.statusChip}>
              <Ionicons name="checkmark-circle" size={18} color={colors.ok} />
              <Text style={[styles.statusText, { color: colors.ok }]}>
                Punched {punchType === "IN" ? "in" : "out"}{geoCheck?.branchName ? ` at ${geoCheck.branchName}` : ""}
              </Text>
            </View>
          ) : (
            <LocationRow state={loc} onRefresh={refreshLocation} />
          )}

          {/* Distance status chip */}
          {geoCheck && phase !== "done" ? (
            <View style={[styles.distanceChip, geoCheck.inRange ? styles.distanceOk : styles.distanceFar]}>
              <Ionicons
                name={geoCheck.inRange ? "checkmark-circle" : "warning"}
                size={16}
                color={geoCheck.inRange ? colors.ok : colors.danger}
              />
              <Text style={[styles.distanceText, { color: geoCheck.inRange ? colors.ok : colors.danger }]}>
                {geoCheck.inRange
                  ? `${geoCheck.distance}m from ${geoCheck.branchName} (within ${geoCheck.allowed}m)`
                  : `${geoCheck.distance}m from ${geoCheck.branchName} — move within ${geoCheck.allowed}m to punch`}
              </Text>
            </View>
          ) : null}

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
              disabled={busy || outOfRange}
              accessibilityRole="button"
              accessibilityLabel={`Take your ${actionLabel} photo`}
              style={({ pressed }) => [
                styles.shutter,
                { opacity: busy || outOfRange ? 0.35 : pressed ? 0.85 : 1 },
              ]}
            >
              {busy ? <ActivityIndicator color={colors.brand} /> : <View style={styles.shutterInner} />}
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
                  disabled={loc.kind !== "ready" || outOfRange}
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
            ? "Finding your location…"
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

// ─── Geo helpers ───────────────────────────────────────────────────────────────

/** Haversine distance in metres between two lat/lng points. */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Find the nearest branch and check whether the user is within its radius. */
function findNearest(lat: number, lon: number, branches: Branch[]): GeoCheck {
  let best: { name: string; dist: number; allowed: number } | null = null;
  for (const b of branches) {
    const bLat = parseFloat(b.latitude);
    const bLon = parseFloat(b.longitude);
    if (isNaN(bLat) || isNaN(bLon)) continue;
    const dist = haversine(lat, lon, bLat, bLon);
    if (!best || dist < best.dist) {
      best = { name: b.name, dist, allowed: b.radius };
    }
  }
  if (!best) return null;
  return {
    inRange: best.dist <= best.allowed,
    branchName: best.name,
    distance: best.dist,
    allowed: best.allowed,
  };
}

// ─── Styles ────────────────────────────────────────────────────────────────────

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
  topTitle: { ...type.heading, color: colors.white, fontSize: 17 },
  guide: {
    alignSelf: "center",
    width: 250,
    height: 320,
    borderRadius: 140,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.55)",
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
  statusText: { ...type.small, color: colors.white, fontWeight: "600" },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  refreshText: { ...type.small, color: colors.white, fontWeight: "600", fontSize: 12 },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.4)",
  },
  shutterInner: { width: 60, height: 60, borderRadius: radius.pill, backgroundColor: colors.brand },
  reviewActions: { flexDirection: "row", gap: spacing.md, alignSelf: "stretch" },
  reviewButton: { flex: 1 },
  hint: { ...type.small, color: colors.white, opacity: 0.75, textAlign: "center" },
  permission: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xl,
    justifyContent: "center",
    gap: spacing.md,
  },
  permTitle: { ...type.title, color: colors.ink },
  permBody: { ...type.body, color: colors.inkSoft, lineHeight: 21, marginBottom: spacing.sm },
  distanceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignSelf: "center",
  },
  distanceOk: { backgroundColor: colors.okTint },
  distanceFar: { backgroundColor: colors.dangerTint },
  distanceText: { ...type.small, fontWeight: "600", fontSize: 12 },
});
