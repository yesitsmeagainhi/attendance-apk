import * as Location from "expo-location";
import * as ImageManipulator from "expo-image-manipulator";
import { LOCATION_TIMEOUT_MS, PHOTO_MAX_WIDTH, PHOTO_QUALITY } from "../config";

export class PunchPrepError extends Error {}

/**
 * Get a GPS fix, or fail with a message worth showing.
 *
 * The punch endpoint rejects any request without coordinates, so this is not
 * optional. A cold fix can take 10-20s, which is why callers start this in
 * parallel with opening the camera rather than after the shutter.
 */
export async function acquireLocation(): Promise<{ latitude: number; longitude: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new PunchPrepError(
      "Location permission is required to punch. Enable it for Attendly in Settings.",
    );
  }

  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    throw new PunchPrepError("Turn on GPS / location services, then try again.");
  }

  const fix = await withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    LOCATION_TIMEOUT_MS,
    "Couldn't get a GPS fix. Move somewhere with a clearer view of the sky and try again.",
  );

  return { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
}

/**
 * Downscale and re-encode the selfie.
 *
 * The server hard-rejects anything over 5 MB and modern phone cameras routinely
 * produce 4-8 MB, so skipping this causes punches that fail only on good
 * handsets — the least obvious failure mode in the whole flow.
 */
export async function compressPhoto(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ flip: ImageManipulator.FlipType.Horizontal }, { resize: { width: PHOTO_MAX_WIDTH } }],
    { compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PunchPrepError(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * "2026-08-22 09:05:00" -> "2:35 PM"
 *
 * Punch timestamps are written by SQLite's CURRENT_TIMESTAMP, which is UTC, and
 * the server re-reads them as UTC before converting to IST. Parsing the clock
 * digits directly would render every time 5.5 hours off, so this appends the Z
 * the same way the server does and lets the device localise it.
 */
export function formatTime(raw: string | null | undefined): string {
  if (!raw) return "--:--";
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The history and timesheet APIs return durations as whole minutes. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * "09:00" -> "9:00 AM"   "18:30" -> "6:30 PM"
 *
 * Shift times from the API are plain "HH:MM" strings (24-hour, no timezone).
 */
export function formatShiftTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "--";
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "2026-08-22" -> "Sat, 22 Aug" */
export function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
