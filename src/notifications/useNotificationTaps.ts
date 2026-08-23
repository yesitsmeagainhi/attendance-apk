import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

/**
 * Where a tapped notification lands.
 *
 * A login-code alert is the one that has to go somewhere specific: the admin is
 * on the phone with the person, the code expires in five minutes, and the
 * banner truncates. Tapping it opens the Login codes screen, where the full
 * code sits with its live countdown. Everything else opens the feed.
 */
function routeFor(data: unknown, isAdmin: boolean): string {
  const kind =
    data && typeof data === "object" && "kind" in data
      ? String((data as { kind?: unknown }).kind)
      : "";
  // Login codes are an admin-only screen; an employee tapping anything at all
  // must not be dropped onto a route their role cannot load.
  if (kind === "otp" && isAdmin) return "/admin-codes";
  return "/notifications";
}

/**
 * Routes notification taps, both while the app is running and on a cold start
 * where the tap is what launched the process.
 *
 * The imperative `router` is used rather than `useRouter()` because this runs
 * above the navigator in the tree, where the hook's context is not available.
 */
export function useNotificationTaps(signedIn: boolean, isAdmin: boolean) {
  /** A tap that arrived before there was a session to route it into. */
  const pending = useRef<string | null>(null);
  /** A cold-start response is delivered once; this stops it replaying. */
  const coldStartHandled = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Cold start: the app was killed and the tap launched it.
    (async () => {
      if (coldStartHandled.current) return;
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (cancelled || !last) return;
        coldStartHandled.current = true;
        pending.current = routeFor(last.notification.request.content.data, isAdmin);
      } catch {
        // No launch response available; nothing to route.
      }
    })();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = routeFor(response.notification.request.content.data, isAdmin);
      if (signedIn) router.push(route as never);
      else pending.current = route;
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [signedIn, isAdmin]);

  // Flush a queued tap once signed in.
  useEffect(() => {
    if (!signedIn || !pending.current) return;
    const route = pending.current;
    pending.current = null;

    // The auth gate issues its own replace() the moment the session restores.
    // Pushing in the same tick would be overwritten by it, so this waits for
    // that redirect to settle before pushing the destination on top.
    const timer = setTimeout(() => router.push(route as never), 400);
    return () => clearTimeout(timer);
  }, [signedIn]);
}
