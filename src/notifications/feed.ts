import * as SecureStore from "expo-secure-store";
import { api, ApiError } from "../api/client";
import { adminApi } from "../api/admin";
import { formatTime } from "../lib/punch";

/**
 * Feed construction, shared by the in-app provider and the background task.
 *
 * It lives outside the React tree on purpose: the background worker runs in a
 * fresh JS context with no component state, so anything it needs must be a
 * plain function plus SecureStore. Keeping one implementation means the banner
 * an admin gets while the app is closed is built from exactly the same rules as
 * the list they see when they open it.
 */

export type FeedKind = "punch" | "request" | "birthday" | "otp";

export type FeedItem = {
  id: string;
  kind: FeedKind;
  title: string;
  body: string;
  /** ISO-ish server timestamp, or a local ISO string for derived entries. */
  at: string;
  photoKey?: string | null;
  unread: boolean;
};

/** Read watermark: what the user has looked at. Drives the unread badge. */
export const SEEN_KEY = "attendly.notify.lastSeen";
/**
 * Alert watermark: what has already been banner'd. Separate from SEEN_KEY so
 * that opening the list (which clears unread) does not also suppress a banner
 * for something that arrives a second later — and so the foreground poller and
 * the background worker cannot double-alert the same punch.
 */
export const ALERTED_KEY = "attendly.notify.lastAlerted";

/**
 * Alert watermarks are held PER KIND, not as one scalar.
 *
 * A single mark let one source poison the others. The birthday row carries a
 * synthetic 10:00 timestamp, so a shared mark jumped forward to 10:00 and
 * silently swallowed every punch and login code earlier in the morning — the
 * exact window this feature exists for. Per-kind marks also mean a failed
 * requests fetch cannot advance past a request it never saw.
 */
export type AlertMarks = { punch: number; request: number; otp: number };

export type AlertKind = keyof AlertMarks;

/** Which sources answered. A mark only advances for a source that succeeded. */
export type FetchOk = { punch: boolean; request: boolean; otp: boolean; birthday: boolean };

const EMPTY_MARKS: AlertMarks = { punch: 0, request: 0, otp: 0 };

export async function getAlertMarks(): Promise<AlertMarks> {
  try {
    const raw = await SecureStore.getItemAsync(ALERTED_KEY);
    if (!raw) return { ...EMPTY_MARKS };
    const parsed = JSON.parse(raw) as Partial<AlertMarks>;
    return {
      punch: Number(parsed.punch) || 0,
      request: Number(parsed.request) || 0,
      otp: Number(parsed.otp) || 0,
    };
  } catch {
    // Includes the pre-upgrade scalar format, which JSON.parse turns into a
    // number rather than an object: treat anything unreadable as "start fresh".
    return { ...EMPTY_MARKS };
  }
}

export async function setAlertMarks(marks: AlertMarks) {
  try {
    await SecureStore.setItemAsync(ALERTED_KEY, JSON.stringify(marks));
  } catch {
    // A persistent failure here would re-alert the same batch every pass, so
    // it is worth knowing about in development.
    if (__DEV__) console.log("[notify] could not persist alert marks");
  }
}

const TOKEN_KEY = "attendly.session.token";
const ROLE_KEY = "attendly.session.role";

/**
 * Sentinel photo keys the server uses for admin-marked and miss-punch records.
 * They are not images; rendering one produces a broken thumbnail.
 */
export function isRealPhoto(key: string | null | undefined): key is string {
  if (!key) return false;
  if (key === "admin-marked" || key === "admin/unpaid-holiday") return false;
  if (key.startsWith("miss-punch/")) return false;
  return true;
}

/** "2026-08-22 03:41:20" (UTC, no zone) -> epoch ms. Mirrors formatTime's parsing. */
export function toMs(raw: string | null | undefined): number {
  if (!raw) return 0;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  const ms = d.getTime();
  return isNaN(ms) ? 0 : ms;
}

export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function getWatermark(key: string): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    const n = raw ? Number(raw) : 0;
    return isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

export async function setWatermark(key: string, value: number) {
  try {
    await SecureStore.setItemAsync(key, String(value));
  } catch {
    // A failed write only costs a duplicate badge or banner next time.
  }
}

/**
 * Credentials for a context that has no AuthContext — i.e. the background
 * worker. Returns null when nobody is signed in, which is the signal to do
 * nothing rather than to error.
 */
export async function readStoredSession(): Promise<{ token: string; isAdmin: boolean } | null> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return null;
    const role = await SecureStore.getItemAsync(ROLE_KEY);
    return { token, isAdmin: role === "admin" };
  } catch {
    return null;
  }
}

/**
 * True when the birthday endpoint is absent, so it stops being asked for.
 * Cleared by resetFeedState() on sign-in, so deploying the backend does not
 * require reinstalling the app.
 */
let birthdaysUnavailable = false;

export function resetFeedState() {
  birthdaysUnavailable = false;
}

export async function buildFeed(isAdmin: boolean): Promise<{
  feed: FeedItem[];
  birthdays: Array<{ id: string; name: string; jobRole: string }>;
  ok: FetchOk;
}> {
  const feed: FeedItem[] = [];
  // Every source starts "not answered"; only a completed fetch flips it true.
  const ok: FetchOk = { punch: false, request: false, otp: false, birthday: false };

  // --- birthdays: everyone sees these -----------------------------------
  let birthdays: Array<{ id: string; name: string; jobRole: string }> = [];
  try {
    if (birthdaysUnavailable) throw new Error("skipped");
    const res = await api.birthdays();
    birthdays = res?.birthdays ?? [];
    ok.birthday = true;
    for (const b of birthdays) {
      feed.push({
        id: `birthday:${res.date}:${b.id}`,
        kind: "birthday",
        title: `🎂 ${b.name}'s birthday`,
        body: `It's ${b.name}'s birthday today${b.jobRole ? ` · ${b.jobRole}` : ""}. Send them a wish.`,
        at: new Date(`${res.date}T10:00:00`).toISOString(),
        unread: false,
      });
    }
  } catch (e) {
    // Absent, not broken: no birthdays until the backend carrying the
    // migration is deployed.
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
      birthdaysUnavailable = true;
    }
  }

  if (isAdmin) {
    // --- login codes waiting to be read out ------------------------------
    try {
      const otp = await adminApi.otpRequests();
      ok.otp = true;
      for (const c of otp?.otpRequests ?? []) {
        feed.push({
          id: `otp:${c.id}`,
          kind: "otp",
          title: `${c.employeeName} needs a login code`,
          // The code goes in the body deliberately: the admin is usually on the
          // phone with the person and it expires in five minutes. The Android
          // channel is PRIVATE, so a locked screen hides it.
          body: `Code ${c.otpCode} · expires ${formatTime(c.expiresAt)}`,
          at: c.createdAt,
          unread: false,
        });
      }
    } catch {
      // ignore
    }

    // --- staff punches today ---------------------------------------------
    try {
      const day = await adminApi.dailyAttendance(isoDay(new Date()));
      ok.punch = true;
      for (const emp of day?.employees ?? []) {
        for (const [type, punch] of [
          ["in", emp.punchIn],
          ["out", emp.punchOut],
        ] as const) {
          if (!punch?.time) continue;
          // Admin-marked rows are the admin's own doing; no alert for those.
          if (punch.source === "admin") continue;
          feed.push({
            id: `punch:${emp.id}:${type}:${punch.time}`,
            kind: "punch",
            title: `${emp.name} punched ${type}`,
            body: `${formatTime(punch.time)}${punch.office ? ` · ${punch.office}` : ""}`,
            at: punch.time,
            photoKey: isRealPhoto(punch.photoKey) ? punch.photoKey : null,
            unread: false,
          });
        }
      }
    } catch {
      // ignore — a failed poll must not clear the rest of the feed
    }

    // --- requests waiting on them ----------------------------------------
    try {
      const [miss, leave] = await Promise.all([adminApi.missPunches(), adminApi.leaves()]);
      ok.request = true;
      for (const r of miss?.requests ?? []) {
        if (r.status !== "pending") continue;
        feed.push({
          id: `req:miss:${r.id}`,
          kind: "request",
          title: `${r.employeeName} asked for a miss-punch fix`,
          body: `${r.punchType === "IN" ? "Punch in" : "Punch out"} at ${r.requestedTime} · ${r.date}`,
          at: r.createdAt,
          unread: false,
        });
      }
      for (const r of leave?.requests ?? []) {
        if (r.status !== "pending") continue;
        feed.push({
          id: `req:leave:${r.id}`,
          kind: "request",
          title: `${r.employeeName} requested leave`,
          body: `${r.leaveType} · ${r.fromDate}${r.toDate !== r.fromDate ? ` – ${r.toDate}` : ""}`,
          at: r.createdAt,
          unread: false,
        });
      }
    } catch {
      // ignore
    }
  } else {
    // --- employee: my own punches today -----------------------------------
    try {
      const status = await api.status();
      ok.punch = true;
      for (const p of status?.punches ?? []) {
        feed.push({
          id: `mypunch:${p.type}:${p.time}`,
          kind: "punch",
          title: `You punched ${p.type === "IN" ? "in" : "out"}`,
          body: `${formatTime(p.time)}${p.office ? ` · ${p.office}` : ""}`,
          at: p.time,
          photoKey: isRealPhoto(p.photoKey) ? p.photoKey : null,
          unread: false,
        });
      }
    } catch {
      // ignore
    }

    // --- employee: decisions on my requests -------------------------------
    try {
      const [miss, leave] = await Promise.all([api.missPunches(), api.leaves()]);
      ok.request = true;
      for (const r of miss?.requests ?? []) {
        if (r.status === "pending" || !r.reviewedAt) continue;
        feed.push({
          id: `mine:miss:${r.id}:${r.status}`,
          kind: "request",
          title: `Miss-punch ${r.status}`,
          body: `${r.punchType === "IN" ? "Punch in" : "Punch out"} on ${r.date}${r.adminNote ? ` · ${r.adminNote}` : ""}`,
          at: r.reviewedAt,
          unread: false,
        });
      }
      for (const r of leave?.requests ?? []) {
        if (r.status === "pending" || !r.reviewedAt) continue;
        feed.push({
          id: `mine:leave:${r.id}:${r.status}`,
          kind: "request",
          title: `Leave ${r.status}`,
          body: `${r.leaveType} from ${r.fromDate}${r.adminNote ? ` · ${r.adminNote}` : ""}`,
          at: r.reviewedAt,
          unread: false,
        });
      }
    } catch {
      // ignore
    }
  }

  feed.sort((a, b) => toMs(b.at) - toMs(a.at));
  // An employee never queries the OTP endpoint, so it can never be "stale".
  if (!isAdmin) ok.otp = true;
  return { feed, birthdays, ok };
}
