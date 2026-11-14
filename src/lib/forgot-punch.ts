import type { PunchStatus } from "../api/client";

/** Current time in India, regardless of the phone's time zone. */
function istNow(): Date {
  // Shift UTC by +5:30 and read the result with getUTC* methods
  return new Date(Date.now() + 330 * 60_000);
}

/** "YYYY-MM-DD" today in India. */
export function istToday(): string {
  return istNow().toISOString().slice(0, 10);
}

/**
 * True when a punch now is probably meant as a punch-out from a day the
 * employee forgot to punch in: nothing punched (or requested) today, and it's
 * already past the middle of their shift. Flexible staff are left out: they
 * punch many sessions a day, so the time says nothing.
 * Same rule as the web app (ForgotPunchInDialog.tsx).
 */
export function looksLikeForgottenPunchIn(status: PunchStatus | null): boolean {
  if (!status || status.flexibleHours) return false;
  if (status.nextPunchType !== "IN" || (status.punches?.length ?? 0) > 0) return false;
  const [sh, sm] = (status.workStartTime || "09:00").split(":").map(Number);
  const [eh, em] = (status.workEndTime || "18:00").split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (!(end > start)) return false;
  const now = istNow();
  return now.getUTCHours() * 60 + now.getUTCMinutes() >= start + (end - start) / 2;
}
