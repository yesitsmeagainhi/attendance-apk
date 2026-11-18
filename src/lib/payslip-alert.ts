import * as SecureStore from "expo-secure-store";
import { api, PayslipSummary } from "../api/client";

/**
 * In-app "your payslip is ready" alert (no push service involved).
 *
 * The server only creates payslips for staff with a salary (monthly salary, or
 * an hourly rate for flexible staff), so employees without one never have a
 * published month and never see the alert.
 *
 * The phone remembers, per employee, the newest payslip month they have seen.
 * A newer published month shows the alert on Today until the employee opens
 * that payslip or dismisses the card. Re-publishing the same month (e.g. after
 * a correction) doesn't bring it back: one alert per month.
 */
const seenKey = (employeeId: string) =>
  `attendly.payslips.seen.${employeeId.replace(/[^A-Za-z0-9._-]/g, "_")}`;

/** Today checks on every focus; don't refetch the list more than this often. */
const CHECK_EVERY_MS = 5 * 60_000;
let cache: { employeeId: string; at: number; latest: PayslipSummary | null } | null = null;

/** The newest published payslip if the employee hasn't seen it yet, else null. Never throws. */
export async function getUnseenPayslip(employeeId: string): Promise<PayslipSummary | null> {
  if (!employeeId) return null;
  try {
    let latest: PayslipSummary | null;
    if (cache && cache.employeeId === employeeId && Date.now() - cache.at < CHECK_EVERY_MS) {
      latest = cache.latest;
    } else {
      const res = await api.payslips(); // newest first
      latest = res.payslips[0] ?? null;
      cache = { employeeId, at: Date.now(), latest };
    }
    if (!latest) return null;
    const seen = await SecureStore.getItemAsync(seenKey(employeeId));
    // Months are "YYYY-MM", so string comparison is chronological
    return !seen || latest.month > seen ? latest : null;
  } catch {
    return null; // offline or server error: just no alert
  }
}

/** Remember that the employee has seen (or dismissed) this month's payslip. */
export async function markPayslipSeen(employeeId: string, month: string): Promise<void> {
  if (!employeeId || !month) return;
  try {
    const key = seenKey(employeeId);
    const seen = await SecureStore.getItemAsync(key);
    if (!seen || month > seen) await SecureStore.setItemAsync(key, month);
  } catch {
    // best effort: worst case the alert shows once more
  }
}
