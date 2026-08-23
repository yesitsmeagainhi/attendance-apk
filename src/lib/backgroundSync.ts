import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { setAuthToken } from "../api/client";
import {
  AlertKind,
  AlertMarks,
  buildFeed,
  FeedItem,
  getAlertMarks,
  readStoredSession,
  setAlertMarks,
  toMs,
} from "../notifications/feed";
import { present, scheduleBirthdayWish } from "./notify";

/**
 * Background delivery.
 *
 * Without this, notifications only exist while the app is open — which is
 * exactly when an admin least needs telling that someone punched in. Android's
 * WorkManager wakes the app periodically even after it has been swiped away,
 * runs this task in a fresh JS context, and lets it post local notifications.
 *
 * Two honest limits, both imposed by the platform rather than by this code:
 *
 *  - The interval is a REQUEST, not a promise. Android will not run it more
 *    often than roughly every 15 minutes, and Doze can stretch that further on
 *    an idle device. A punch alert may therefore arrive minutes late.
 *  - A five-minute login code cannot be delivered reliably this way. Codes are
 *    still built into the feed, but if an admin needs them the instant they are
 *    requested, that needs real push (FCM) — see registerForPushToken().
 */

export const SYNC_TASK = "attendly-background-sync";

/** Matches the foreground poller, so both behave identically. */
const BURST_LIMIT = 3;

/**
 * Fetch, diff against the alert watermark, and post whatever is new.
 *
 * Shared by the background worker and the foreground poller so that a punch
 * cannot be announced twice — both advance the same watermark.
 */
export async function syncAndAlert(isAdmin: boolean): Promise<{
  feed: FeedItem[];
  birthdays: Array<{ id: string; name: string; jobRole: string }>;
  alerted: number;
}> {
  const marks = await getAlertMarks();
  const { feed, birthdays, ok } = await buildFeed(isAdmin);

  const markFor = (i: FeedItem): number =>
    i.kind === "birthday" ? Number.POSITIVE_INFINITY : marks[i.kind as AlertKind];

  const fresh: FeedItem[] = feed.filter(
    (i) => i.kind !== "birthday" && toMs(i.at) > markFor(i),
  );

  // Login codes always alert individually, however busy the poll was: the six
  // digits ARE the notification.
  const codes = fresh.filter((f) => f.kind === "otp");
  const rest = fresh.filter((f) => f.kind !== "otp");

  for (const c of codes) {
    await present(c.title, c.body, { kind: "otp" });
  }

  if (rest.length > BURST_LIMIT) {
    const punches = rest.filter((f) => f.kind === "punch").length;
    const requests = rest.length - punches;
    const parts = [
      punches ? `${punches} punch${punches === 1 ? "" : "es"}` : "",
      requests ? `${requests} request${requests === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    await present(`${rest.length} new updates`, `${parts.join(" and ")} since you last looked.`, {
      kind: "digest",
    });
  } else {
    for (const item of rest) {
      await present(item.title, item.body, { kind: item.kind });
    }
  }

  // Advance each mark past the newest item of THAT kind, and only when that
  // source actually answered — a failed requests fetch must not skip past a
  // request it never saw, and the birthday row's synthetic 10:00 stamp must
  // never touch the punch mark. Advancing to the newest item rather than to
  // Date.now() keeps both sides of the comparison server-derived, so clock
  // skew between phone and server cannot lose a punch.
  const next: AlertMarks = { ...marks };
  for (const kind of ["punch", "request", "otp"] as AlertKind[]) {
    if (!ok[kind]) continue;
    const newest = feed
      .filter((i) => i.kind === kind)
      .reduce((max, i) => Math.max(max, toMs(i.at)), marks[kind]);
    next[kind] = newest;
  }
  if (
    next.punch !== marks.punch ||
    next.request !== marks.request ||
    next.otp !== marks.otp
  ) {
    await setAlertMarks(next);
  }

  // Only touch the OS schedule when the birthday endpoint actually answered.
  // scheduleBirthdayWish cancels before it re-creates, so calling it with an
  // empty list after a failed fetch would delete a wish already scheduled for
  // 10:00 and put nothing back.
  if (ok.birthday) {
    await scheduleBirthdayWish(birthdays.map((b) => b.name));
  }

  return { feed, birthdays, alerted: fresh.length };
}

/**
 * Defined at module load, before any React renders. TaskManager requires the
 * definition to exist at startup so the OS can route a wake-up into it even
 * when the app is launched headless.
 */
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    const stored = await readStoredSession();
    if (!stored) {
      // Signed out is a legitimate no-op, but it is also what a SecureStore
      // failure looks like — so say which, or a silent worker is unfalsifiable.
      if (__DEV__) console.log("[bg-sync] no stored session; nothing to do");
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // A fresh JS context has no in-memory token; restore it from SecureStore
    // before any request goes out, or every call comes back 401.
    setAuthToken(stored.token);
    const { alerted } = await syncAndAlert(stored.isAdmin);
    if (__DEV__) {
      console.log(`[bg-sync] ran as ${stored.isAdmin ? "admin" : "employee"}, ${alerted} new`);
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    if (__DEV__) console.log("[bg-sync] failed:", e instanceof Error ? e.message : e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync() {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
    const already = await TaskManager.isTaskRegisteredAsync(SYNC_TASK);
    if (already) return;
    // 15 minutes is the floor Android honours; asking for less is ignored.
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 });
  } catch {
    // Background delivery is a bonus; the foreground poller still works.
  }
}

export async function unregisterBackgroundSync() {
  try {
    if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
    }
  } catch {
    // ignore
  }
}

/** Debug-only: force the worker to run now, for verification. */
export async function triggerBackgroundSyncForTesting(): Promise<boolean> {
  try {
    return await BackgroundTask.triggerTaskWorkerForTestingAsync();
  } catch {
    return false;
  }
}
