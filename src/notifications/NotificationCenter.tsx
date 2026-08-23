import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../auth/AuthContext";
import { ensurePermission, installNotificationHandler } from "../lib/notify";
import {
  registerBackgroundSync,
  syncAndAlert,
  unregisterBackgroundSync,
} from "../lib/backgroundSync";
import { cancelBirthdayWish, getPushToken } from "../lib/notify";
import { api } from "../api/client";
import { useNotificationTaps } from "./useNotificationTaps";
import {
  FeedItem,
  FeedKind,
  ALERTED_KEY,
  SEEN_KEY,
  getWatermark,
  resetFeedState,
  setWatermark,
  toMs,
} from "./feed";

/**
 * The notification centre.
 *
 * The feed is DERIVED from the server on every refresh rather than stored — a
 * device-local log would drift from the database the moment anything was
 * approved on the web. What is persisted is only a per-kind "last seen"
 * timestamp, which is small enough for SecureStore and is all that is needed to
 * decide what counts as unread and what deserves a banner.
 *
 * Alerts only fire for items that appeared AFTER this session started. Without
 * that floor, opening the app for the first time in a week would dump a week of
 * banners into the tray at once.
 */

export type { FeedItem, FeedKind };

type Ctx = {
  items: FeedItem[];
  unread: number;
  birthdays: Array<{ id: string; name: string; jobRole: string }>;
  loading: boolean;
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationContext = createContext<Ctx | null>(null);

/**
 * Foreground poll. Deliberately NOT gated on AppState being "active": while the
 * process is alive a backgrounded app should keep watching, because that is the
 * moment an admin most wants to hear that someone punched in. Once Android kills
 * the process, the background worker in ../lib/backgroundSync.ts takes over.
 */
const POLL_MS = 60_000;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const isAdmin = session?.role === "admin";

  const [items, setItems] = useState<FeedItem[]>([]);
  const [birthdays, setBirthdays] = useState<Array<{ id: string; name: string; jobRole: string }>>([]);
  const [lastSeen, setLastSeen] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const refreshing = useRef(false);
  /**
   * Whether a session has ever been observed. Without it, the very first render
   * (before the stored token is restored) looks identical to a sign-out and
   * tears down the background registration, which restarts WorkManager's
   * 15-minute clock on every single launch.
   */
  const hadSession = useRef(false);
  /** This device's FCM token, kept so sign-out can unregister precisely it. */
  const pushToken = useRef<string | null>(null);

  useEffect(() => {
    installNotificationHandler();
  }, []);

  // Tapping a login-code alert opens the Login codes screen; anything else
  // opens the feed. Handles cold starts, where the tap launched the app.
  useNotificationTaps(!!session, isAdmin);

  // Load the read watermark, ask for permission, and hand the OS a standing
  // job so alerts keep arriving after the app is closed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session) {
        setLastSeen(0);
        setItems([]);
        setBirthdays([]);
        if (hadSession.current) {
          // A real sign-out, not the restore-in-progress state.
          hadSession.current = false;
          // Unregister BEFORE the token is gone, or this device keeps receiving
          // the departed account's notifications — including login codes.
          if (pushToken.current) {
            await api.unregisterPushToken(pushToken.current).catch(() => {});
            pushToken.current = null;
          }
          await unregisterBackgroundSync();
          // A DAILY trigger belongs to the OS and would otherwise keep wishing
          // a happy birthday to a signed-out phone, forever.
          await cancelBirthdayWish();
          // Watermarks are device-wide, so the next account on a shared phone
          // would start silenced by the previous one's marks.
          await setWatermark(SEEN_KEY, 0);
          await SecureStore.deleteItemAsync(ALERTED_KEY).catch(() => {});
        }
        return;
      }
      hadSession.current = true;
      // Remember the token so sign-out can unregister the exact device.
      pushToken.current = await getPushToken();
      // A backend deploy can add the birthday endpoint under a running app.
      resetFeedState();
      const seen = await getWatermark(SEEN_KEY);
      if (!cancelled) setLastSeen(seen);
      // Asked once signed in, rather than at launch: the prompt only makes
      // sense when there is actually something to notify about.
      const granted = await ensurePermission();
      if (granted) {
        registerBackgroundSync();
        // Push is what makes an instant alert possible with the app closed; the
        // background worker's 15-minute floor is too slow for a login code.
        // A failure here is not fatal — the poll and the worker still run.
        if (pushToken.current) {
          api.registerPushToken(pushToken.current).catch(() => {});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const refresh = useCallback(async () => {
    if (!session || refreshing.current) return;
    refreshing.current = true;
    setLoading((prev) => prev || items.length === 0);
    try {
      // One build per tick: syncAndAlert hands back the feed it just fetched.
      // Calling buildFeed again here doubled every poll's API traffic.
      const { feed, birthdays: todays } = await syncAndAlert(isAdmin);
      setItems(feed);
      setBirthdays(todays);
    } catch {
      // A failed poll leaves the last good feed on screen.
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [session, isAdmin]);

  // Poll while the process is alive — backgrounded included — and immediately
  // on resume. Android killing the process is what hands over to the worker.
  useEffect(() => {
    if (!session) return;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [session, refresh]);

  const markAllRead = useCallback(async () => {
    // Anchored to the newest item's SERVER timestamp, not to Date.now(): the
    // unread test compares against server times, so a phone clock running slow
    // would leave rows permanently unread.
    const newest = items.reduce((max, i) => Math.max(max, toMs(i.at)), 0);
    const mark = Math.max(newest, lastSeen);
    setLastSeen(mark);
    await setWatermark(SEEN_KEY, mark);
  }, [items, lastSeen]);

  const withUnread = useMemo(
    () =>
      items.map((i) => ({
        ...i,
        unread: i.kind !== "birthday" && toMs(i.at) > lastSeen,
      })),
    [items, lastSeen],
  );

  const value = useMemo<Ctx>(
    () => ({
      items: withUnread,
      unread: withUnread.filter((i) => i.unread).length,
      birthdays,
      loading,
      refresh,
      markAllRead,
    }),
    [withUnread, birthdays, loading, refresh, markAllRead],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationProvider");
  return ctx;
}
