import { useCallback, useRef } from "react";
import {
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { spacing } from "../theme";

/**
 * Lift a form field so it sits just above the keyboard, and no higher.
 *
 * Use inside a <KeyboardAvoidingView behavior="padding"> (Android is
 * edge-to-edge, so the window no longer resizes for the keyboard by itself)
 * wrapping a ScrollView that gets `scrollRef` and `onScroll`. Call
 * `reveal(view)` from the input's onFocus, passing the view to keep visible:
 * the input itself, or a wrapper around the input and its button.
 *
 * Everything is measured on the device at the moment the keyboard is up: the
 * view, the scroll area's visible bottom (already shortened by the padding)
 * and, when the keyboard event reports it, the keyboard's real top edge.
 * Whichever edge is higher is the limit, so it fits any phone size, keyboard
 * height, and gesture or 3-button navigation. It only scrolls by the amount the
 * view is hidden; a view that is already visible doesn't move, and on very
 * small screens the view's top is never pushed out of sight.
 */
export function useKeyboardReveal() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const reveal = useCallback((target: View | null) => {
    if (!target) return;
    let done = false;
    const run = (keyboardTop?: number) => {
      if (done) return;
      done = true;
      sub.remove();
      clearTimeout(fallback);
      const scroll = scrollRef.current;
      if (!scroll) return;
      target.measureInWindow((_fx, fy, _fw, fh) => {
        (scroll as unknown as View).measureInWindow((_sx, sy, _sw, sh) => {
          let visibleBottom = sy + sh;
          if (keyboardTop && keyboardTop > sy) visibleBottom = Math.min(visibleBottom, keyboardTop);
          const gap = spacing.md; // breathing room between the field and the keyboard
          const hiddenBy = fy + fh + gap - visibleBottom;
          if (hiddenBy <= 0) return; // already visible
          const maxLift = Math.max(0, fy - sy - gap);
          const lift = Math.min(hiddenBy, maxLift || hiddenBy);
          scroll.scrollTo({ y: scrollY.current + lift, animated: true });
        });
      });
    };
    const sub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        const top = e?.endCoordinates?.screenY;
        // Let the keyboard padding apply before measuring
        requestAnimationFrame(() => setTimeout(() => run(top), Platform.OS === "ios" ? 250 : 30));
      },
    );
    // Keyboard already open (moving between fields): no show event will come
    const fallback = setTimeout(() => run(), 450);
  }, []);

  return { scrollRef, onScroll, reveal };
}
