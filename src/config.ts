import Constants from "expo-constants";

/**
 * Which Attendly server the app talks to.
 *
 * Default is the LOCAL dev server, deliberately: testing must never write to
 * production, where 72 real employees' attendance lives. Requests reach the
 * host machine from an emulator via `adb reverse tcp:3000 tcp:3000`.
 *
 * To build against production, override `extra.apiBaseUrl` in app.json with
 * https://asmvikas.abseducationalsolution.com and rebuild.
 */
const DEV_FALLBACK = "http://localhost:3000";

export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? DEV_FALLBACK;

/** True when pointed at anything that is not localhost, so the UI can warn. */
export const IS_PRODUCTION_TARGET = !/localhost|127\.0\.0\.1|10\.0\.2\.2/.test(API_BASE_URL);

/**
 * The punch endpoint rejects images over 5 MB. Phone cameras routinely produce
 * 4-8 MB, so every selfie is downscaled before upload.
 */
export const PHOTO_MAX_WIDTH = 1280;
export const PHOTO_QUALITY = 0.8;

/** A cold GPS fix can take a while; fail with a clear message rather than hang. */
export const LOCATION_TIMEOUT_MS = 20_000;
