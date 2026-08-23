import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

/**
 * Local notification plumbing.
 *
 * These are LOCAL notifications, not push. That is a deliberate limit, not an
 * oversight: remote push on Android needs FCM credentials for this Firebase
 * project, which the app cannot mint for itself. What local buys us:
 *
 *  - the birthday wish fires at 10:00 even with the app closed, because it is
 *    scheduled on the device ahead of time by the OS;
 *  - punch and approval alerts fire while the app is running, driven by the
 *    watchers in ../notifications/NotificationCenter.tsx.
 *
 * When FCM is set up later, `registerForPushToken()` below is the only piece
 * that needs filling in — everything else keeps working unchanged.
 */

export const CHANNEL_ID = "attendly-default";

/** Identifier for the repeating birthday reminder, so it can be replaced. */
const BIRTHDAY_ID = "attendly-birthday-daily";

let handlerInstalled = false;

/**
 * Show notifications while the app is in the foreground too. Without this the
 * OS swallows anything delivered while the user is looking at the app, which is
 * exactly when a punch alert is most useful.
 */
export function installNotificationHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask once, and report what we ended up with. Android 13+ requires the runtime
 * POST_NOTIFICATIONS grant; older versions return granted without a prompt.
 */
export async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;

  if (!granted && current.canAskAgain) {
    const asked = await Notifications.requestPermissionsAsync();
    granted = asked.granted;
  }

  if (granted && Platform.OS === "android") {
    // A channel is mandatory on Android 8+; without one, nothing is delivered.
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Attendly",
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 200],
      enableVibrate: true,
    });
  }

  return granted;
}

/**
 * Fire one now. Failures are swallowed: a missed banner must never break a punch.
 *
 * `channelId` is a TRIGGER property, not a content one — passing it inside
 * `content` is silently dropped, and `trigger: null` carries no channel at all,
 * so every notification lands on Expo's fallback channel at HIGH importance.
 * That matters here beyond tidiness: the fallback channel is not PRIVATE, so a
 * login code in the body would be readable on a locked screen. A one-second
 * interval trigger is imperceptible and keeps the configured channel.
 */
export async function present(title: string, body: string, data?: Record<string, unknown>) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data },
      trigger:
        Platform.OS === "android"
          ? {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 1,
              repeats: false,
              channelId: CHANNEL_ID,
            }
          : null,
    });
  } catch {
    // ignore
  }
}

/**
 * Schedule (or re-schedule) the 10:00 birthday wish.
 *
 * The OS owns the repeat, so it survives the app being closed or killed. It is
 * cancelled and re-created on every refresh because the body carries the names,
 * and those change from day to day.
 */
export async function scheduleBirthdayWish(names: string[], hour = 10, minute = 0) {
  try {
    await cancelBirthdayWish();
    if (!names.length) return;

    const who =
      names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

    await Notifications.scheduleNotificationAsync({
      identifier: BIRTHDAY_ID,
      content: {
        title: names.length === 1 ? `🎂 It's ${who}'s birthday` : "🎂 Birthdays today",
        body:
          names.length === 1
            ? `Wish ${who} a happy birthday today.`
            : `Wish ${who} a happy birthday today.`,
        data: { kind: "birthday" },
        ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
      },
    });
  } catch {
    // ignore
  }
}

/** Called on sign-out: a DAILY trigger otherwise repeats forever on a signed-out phone. */
export async function cancelBirthdayWish() {
  try {
    await Notifications.cancelScheduledNotificationAsync(BIRTHDAY_ID);
  } catch {
    // Not scheduled yet — nothing to cancel.
  }
}

/**
 * The device's FCM token, or null when push is not available here.
 *
 * Null is the normal answer on a build without `google-services.json`: Firebase
 * cannot issue a token, and the call throws. That is not an error state — the
 * app falls back to its foreground poll and its background worker, and only
 * loses the ability to be woken instantly.
 */
export async function getPushToken(): Promise<string | null> {
  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    const token = typeof data === "string" ? data : null;
    // Worth logging in development: without it there is no way to tell "push is
    // configured and registered" apart from "push silently unavailable".
    if (__DEV__) console.log("[push] device token:", token ? token.slice(0, 24) + "…" : "none");
    return token;
  } catch (e) {
    if (__DEV__) console.log("[push] no token:", e instanceof Error ? e.message : e);
    // No Firebase config in this build, or the device has no Play services.
    return null;
  }
}
