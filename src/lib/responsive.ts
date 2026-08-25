import { Dimensions, useWindowDimensions } from "react-native";

/**
 * Base design width. The current hardcoded sizes look correct at ~375dp
 * (a typical 5.5–6" Android phone). We scale proportionally from this baseline.
 */
const BASE_WIDTH = 375;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const RATIO = Math.min(Math.max(SCREEN_WIDTH / BASE_WIDTH, 0.85), 1.3);

/**
 * Module-level scale — usable anywhere including StyleSheet.create().
 * Scales a dp value relative to the 375dp design baseline,
 * clamped between 0.85x (small phones) and 1.3x (large phones / small tablets).
 */
export const s = (size: number) => Math.round(size * RATIO);

/** Vertical scale — proportional to screen height (baseline 812dp). */
export const vs = (size: number) =>
  Math.round(size * Math.min(Math.max(SCREEN_HEIGHT / 812, 0.85), 1.3));

/**
 * Proportional scaling tied to the current window dimensions.
 *
 *   wp(n)    → n% of window width
 *   hp(n)    → n% of window height
 *   scale(n) → n scaled relative to BASE_WIDTH, clamped to 0.85x–1.3x
 */
export function useResponsive() {
  const { width, height } = useWindowDimensions();

  const wp = (pct: number) => (pct / 100) * width;
  const hp = (pct: number) => (pct / 100) * height;

  const scale = (size: number) => {
    const ratio = Math.min(Math.max(width / BASE_WIDTH, 0.85), 1.3);
    return Math.round(size * ratio);
  };

  return { width, height, wp, hp, scale };
}
