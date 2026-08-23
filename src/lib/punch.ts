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
    [{ resize: { width: PHOTO_MAX_WIDTH } }],
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

/** "2026-08-22" -> "Sat, 22 Aug" */
export function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Metres between two coordinates (haversine, spherical earth is close enough here). */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export type NearestBranch = {
  name: string;
  distance: number;
  allowedRadius: number;
  inside: boolean;
};

/**
 * Closest office to the current fix, so the punch screen can tell the user how
 * far off they are *before* they take a selfie the server will reject anyway.
 * The server remains the authority on whether a punch is allowed; this is only
 * a heads-up, and returns null when the branch list is empty or unusable.
 */
export function nearestBranch(
  fix: { latitude: number; longitude: number },
  branches: Array<{ name: string; latitude: string; longitude: string; radius: number }>,
): NearestBranch | null {
  let best: NearestBranch | null = null;
  for (const b of branches) {
    const latitude = Number(b.latitude);
    const longitude = Number(b.longitude);
    if (!isFinite(latitude) || !isFinite(longitude)) continue;
    const distance = distanceMeters(fix, { latitude, longitude });
    if (!best || distance < best.distance) {
      best = { name: b.name, distance, allowedRadius: b.radius, inside: distance <= b.radius };
    }
  }
  return best;
}

/** 320 -> "320 m", 1240 -> "1.2 km" */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
}
