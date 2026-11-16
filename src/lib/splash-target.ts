import { useSyncExternalStore } from "react";
import type { View } from "react-native";

/**
 * Hand-off point between the launch splash and the Today screen's header logo.
 *
 * The Today screen registers its logo view; the splash measures it right
 * before flying (so safe-area padding and layout have settled), flies its big
 * centred logo into exactly that spot, then marks itself `landed` so the real
 * header logo is shown underneath before the flying one fades off.
 */
let targetView: View | null = null;
let landed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const splashTarget = {
  getView: () => targetView,
  setView(v: View | null) {
    targetView = v;
  },
  isLanded: () => landed,
  land() {
    if (landed) return;
    landed = true;
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** True once the launch splash has landed (the header logo may then be shown). */
export function useSplashLanded() {
  return useSyncExternalStore(splashTarget.subscribe, splashTarget.isLanded, splashTarget.isLanded);
}
