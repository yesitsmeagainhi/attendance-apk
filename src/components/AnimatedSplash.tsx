import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { splashTarget } from "../lib/splash-target";

/**
 * Launch logo that flies into the Today screen's header.
 *
 *   1. Full-page logo on white, matching the native splash (same round image,
 *      assets/android-circlebg.png, same 220dp width; see the
 *      expo-splash-screen plugin in app.json), so hiding the native splash is
 *      invisible.
 *   2. When the app is ready, the header logo's position is measured until it
 *      stops moving (safe-area padding can land a frame late), then the logo
 *      glides there on a gentle arc, shrinking to the header size. The header
 *      uses the same image, so only position and scale change. The white page
 *      fades out underneath so Today appears around the logo.
 *   3. On landing the real header logo is shown underneath and the flying one
 *      fades off over it, so any sub-pixel mismatch is never seen as a jump.
 *
 * Every animated value is set up before the animation starts and only
 * transform/opacity are animated, all on the native driver: nothing waits on a
 * React re-render or the JS thread mid-flight.
 */
const LOGO_SIZE = 220; // keep in sync with imageWidth in app.json
const HOLD_MS = 250; // brief beat on the full-page logo before it moves
const FLIGHT_MS = 650;
const MAX_WAIT_MS = 1200; // give up waiting for Today's header and just fade
const HARD_FAILSAFE_MS = 6000; // the overlay is removed by now no matter what

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Measure a view in window coordinates, or null.
 * Never hangs: Android never calls back for a view that has unmounted (e.g.
 * Today mounting for a moment before the gate redirects to Login), so give up
 * after a short timeout instead of waiting forever.
 */
function measure(v: View | null): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!v) return resolve(null);
    const t = setTimeout(() => resolve(null), 150);
    try {
      v.measureInWindow((x, y, width, height) => {
        clearTimeout(t);
        resolve(width ? { x, y, width, height } : null);
      });
    } catch {
      clearTimeout(t);
      resolve(null);
    }
  });
}

const same = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5;

export default function AnimatedSplash({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const startedAt = useRef(0);
  const reduceMotion = useRef(false);
  const logoRef = useRef<View>(null);

  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const page = useRef(new Animated.Value(1)).current; // white page opacity
  const logo = useRef(new Animated.Value(1)).current; // whole flying logo opacity

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { reduceMotion.current = v; })
      .catch(() => { });
  }, []);

  function start() {
    if (startedRef.current) return;
    startedRef.current = true;
    SplashScreen.hide();
    startedAt.current = Date.now();
    setStarted(true);
  }

  // If the logo never reports loaded, start anyway so the app is revealed
  useEffect(() => {
    const t = setTimeout(start, 1500);
    // Hard failsafe: whatever goes wrong below, the overlay can never trap the app
    const kill = setTimeout(() => {
      splashTarget.land();
      setGone(true);
    }, HARD_FAILSAFE_MS);
    return () => {
      clearTimeout(t);
      clearTimeout(kill);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !started) return;
    let cancelled = false;

    const done = () => {
      if (!cancelled) setGone(true);
    };

    // Show the real header logo, then fade the flying one off on top of it
    const land = () => {
      if (cancelled) return;
      splashTarget.land();
      Animated.timing(logo, { toValue: 0, duration: 160, easing: Easing.linear, useNativeDriver: true }).start(done);
    };

    const fadeOut = () => {
      splashTarget.land();
      Animated.parallel([
        Animated.timing(page, { toValue: 0, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(logo, { toValue: 0, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start(done);
    };

    const fly = (from: Rect, to: Rect) => {
      const dx = to.x + to.width / 2 - (from.x + from.width / 2);
      const dy = to.y + to.height / 2 - (from.y + from.height / 2);
      const k = to.width / from.width;
      Animated.parallel([
        // Rising slightly ahead of moving sideways draws a soft arc, not a straight slide
        Animated.timing(ty, { toValue: dy, duration: FLIGHT_MS, easing: Easing.bezier(0.33, 0, 0.12, 1), useNativeDriver: true }),
        Animated.timing(tx, { toValue: dx, duration: FLIGHT_MS, easing: Easing.bezier(0.5, 0, 0.18, 1), useNativeDriver: true }),
        Animated.timing(scale, { toValue: k, duration: FLIGHT_MS, easing: Easing.bezier(0.4, 0, 0.15, 1), useNativeDriver: true }),
        Animated.timing(page, {
          toValue: 0,
          duration: FLIGHT_MS * 0.6,
          delay: FLIGHT_MS * 0.2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(land);
    };

    const go = async () => {
      if (reduceMotion.current) return fadeOut();
      const deadline = Date.now() + MAX_WAIT_MS;
      let prev: Rect | null = null;
      // Wait until Today's header logo exists and has stopped moving
      while (!cancelled && Date.now() < deadline) {
        const to = await measure(splashTarget.getView());
        if (to && prev && same(to, prev)) {
          const from = await measure(logoRef.current);
          if (cancelled) return;
          // Start on the next frame so the native side is idle when it begins
          return from ? requestAnimationFrame(() => fly(from, to)) : fadeOut();
        }
        prev = to;
        await new Promise((r) => setTimeout(r, 60));
      }
      if (!cancelled) fadeOut(); // opened on Login, or Today never laid out
    };

    const t = setTimeout(go, Math.max(0, HOLD_MS - (Date.now() - startedAt.current)));
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ready, started, tx, ty, scale, page, logo]);

  if (gone) return null;

  return (
    <View pointerEvents={ready ? "none" : "auto"} style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.page, { opacity: page }]} />
      <View style={styles.center} pointerEvents="none">
        <Animated.View
          ref={logoRef}
          collapsable={false}
          style={[
            styles.box,
            { opacity: logo, transform: [{ translateX: tx }, { translateY: ty }, { scale }] },
          ]}
        >
          {/* Same round image as the native splash and the Today header logo,
              so size and shape never change from launch to landing */}
          <Animated.Image
            source={require("../../assets/android-circlebg.png")}
            onLoadEnd={start}
            fadeDuration={0}
            style={styles.box}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: "#FFFFFF" },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  box: { width: LOGO_SIZE, height: LOGO_SIZE },
});
