import { File } from "expo-file-system";
import { API_BASE_URL } from "../config";

/**
 * Thin client over the existing Attendly API.
 *
 * Auth rides on `Authorization: Bearer <token>` — getAppIdentity() on the server
 * falls back to that header when there is no session cookie, so the native app
 * needs no cookie jar. Identity is always derived server-side from the token;
 * the client never sends an employee id for itself.
 */

export class ApiError extends Error {
  status: number;
  /** Present on 403 geo-fence rejections from POST /api/attendance. */
  geoAlert?: { branchName: string; distance: number; allowedRadius: number } | null;

  constructor(message: string, status: number, geoAlert?: ApiError["geoAlert"]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.geoAlert = geoAlert;
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (authToken) h.Authorization = `Bearer ${authToken}`;
  return h;
}

async function parse(res: Response) {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body means something upstream failed (proxy, crash page).
    throw new ApiError(
      res.ok ? "The server returned an unreadable response." : `Server error (${res.status}).`,
      res.status,
    );
  }
  if (!res.ok) {
    throw new ApiError(
      body?.error ?? `Request failed (${res.status}).`,
      res.status,
      body?.geoAlert ?? null,
    );
  }
  return body;
}

async function request(path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (cause) {
    // Keep the underlying reason in the log: a transport failure here is
    // indistinguishable from being offline unless the real error survives.
    console.warn(`[api] ${init?.method ?? "GET"} ${path} failed:`, cause);
    throw new ApiError(
      "Can't reach the attendance server. Check your connection and try again.",
      0,
    );
  }
  return parse(res);
}

/**
 * Shared request helper for the admin surface in ./admin.ts, so those routes
 * get the same auth header, error parsing and offline message as the employee
 * ones without re-exporting the internals.
 */
export function adminRequest(
  path: string,
  init?: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown },
) {
  const method = init?.method ?? "GET";
  if (init?.body === undefined) return request(path, { method, headers: headers() });
  return request(path, {
    method,
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(init.body),
  });
}

function getJson(path: string) {
  return request(path, { method: "GET", headers: headers() });
}

function postJson(path: string, body: unknown) {
  return request(path, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

function patchJson(path: string, body: unknown) {
  return request(path, {
    method: "PATCH",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------- auth

export type RequestOtpResult = { ok: true; employeeId: string; employeeName: string };
export type VerifyOtpResult = { role: string; name: string; token: string; employeeId: string };

/**
 * `/api/auth/login` is the web dashboard's email + password endpoint. Its exact
 * response shape is owned by the server, so everything except the token is
 * optional and read defensively -- an admin account has no employee record to
 * borrow a name or id from.
 */
export type AdminLoginResult = {
  token?: string;
  role?: string;
  name?: string;
  employeeId?: string;
  user?: { id?: string; name?: string; role?: string; email?: string; token?: string };
};

export const api = {
  requestOtp: (mobileNumber: string): Promise<RequestOtpResult> =>
    postJson("/api/auth/request-otp", { mobileNumber }),

  verifyOtp: (employeeId: string, otpCode: string): Promise<VerifyOtpResult> =>
    postJson("/api/auth/verify-otp", { employeeId, otpCode }),

  /** Admin sign-in. The OTP flow only ever issues employee sessions. */
  adminLogin: (email: string, password: string): Promise<AdminLoginResult> =>
    postJson("/api/auth/login", { email, password }),

  sessionCheck: (): Promise<{ valid: boolean; role: string }> =>
    getJson("/api/auth/session-check"),

  logout: () => request("/api/auth/logout", { method: "POST", headers: headers() }),

  /**
   * Hand the server this device's FCM token so it can be woken for things that
   * cannot wait for a background poll — a login code above all, since it dies
   * in five minutes and Android will not wake a closed app that fast.
   */
  registerPushToken: (token: string, platform = "android") =>
    postJson("/api/push/register", { token, platform }),

  unregisterPushToken: (token: string) =>
    request("/api/push/register", {
      method: "DELETE",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ token }),
    }),

  // ------------------------------------------------------------ attendance

  status: (): Promise<PunchStatus> => getJson("/api/attendance/status"),

  history: (month?: string): Promise<HistoryResponse> =>
    getJson(`/api/attendance/history${month ? `?month=${encodeURIComponent(month)}` : ""}`),

  branches: (): Promise<{ branches: Branch[] }> => getJson("/api/branches/active"),

  /**
   * Whose birthday it is today. Readable by any signed-in account, employees
   * included — the wish is for the whole office. Rejects with a 404 until the
   * backend carrying the birthday migration is deployed, which callers treat as
   * "no birthdays" rather than an error.
   */
  birthdays: (): Promise<{ date: string; birthdays: BirthdayPerson[] }> =>
    getJson("/api/birthdays"),

  /**
   * The office-wide settings an admin controls from the dashboard. Readable by
   * any signed-in account, employees included — the employee form link is shown
   * on the Profile screen. Missing values come back as "", never null.
   */
  appSettings: (): Promise<{ settings: { employeeFormUrl: string; employeeFormLabel: string } }> =>
    getJson("/api/app-settings"),

  profile: (): Promise<{ profile: Profile }> => getJson("/api/employee/profile"),

  /**
   * The one field an employee owns on their own record, and only twice over:
   * the server counts the self-edits and answers the third with a 403 pointing
   * at Head Office. Saving the date already stored is free — it comes back
   * `{ unchanged: true }` without spending an edit.
   */
  updateMyProfile: (
    dateOfBirth: string,
  ): Promise<{ ok: true; unchanged?: boolean; editsRemaining: number }> =>
    patchJson("/api/employee/profile", { dateOfBirth }),

  /**
   * The punch endpoint takes multipart form data, not JSON, and rejects a photo
   * over 5 MB or missing coordinates. Callers must compress first.
   */
  punch: async (args: {
    photoUri: string;
    punchType: "IN" | "OUT";
    latitude: number;
    longitude: number;
  }) => {
    // React Native's New Architecture (0.81+) removed support for the legacy
    // { uri, name, type } form part that most upload examples still show; it
    // now throws "Unsupported FormDataPart implementation". expo-file-system's
    // File implements Blob, so it can be appended directly.
    const uri = args.photoUri.startsWith("file://")
      ? args.photoUri
      : `file://${args.photoUri}`;

    const form = new FormData();
    form.append("photo", new File(uri) as unknown as Blob, "selfie.jpg");
    form.append("punchType", args.punchType);
    form.append("latitude", String(args.latitude));
    form.append("longitude", String(args.longitude));

    // Content-Type is intentionally omitted: React Native sets the multipart
    // boundary itself, and forcing the header breaks the body parse.
    return request("/api/attendance", { method: "POST", headers: headers(), body: form });
  },

  // ------------------------------------------------------------ requests

  leaves: (): Promise<{ requests: LeaveRequest[] }> => getJson("/api/leave"),

  createLeave: (args: {
    leaveType: "sick" | "casual" | "earned";
    fromDate: string;
    toDate: string;
    reason: string;
  }) => postJson("/api/leave", args),

  missPunches: (): Promise<{ requests: MissPunchRequest[] }> => getJson("/api/miss-punch"),

  createMissPunch: (args: {
    date: string;
    punchType: "IN" | "OUT";
    requestedTime: string;
    reason: string;
  }) => postJson("/api/miss-punch", args),

  // ------------------------------------------------------------ journal

  journal: (date: string): Promise<{ journal: Journal | null }> =>
    getJson(`/api/attendance/journal?date=${encodeURIComponent(date)}`),

  saveJournal: (args: { date: string; tasks: string; todos: string[] }) =>
    postJson("/api/attendance/journal", args),

  timesheet: (month?: string): Promise<Timesheet> =>
    getJson(`/api/attendance/timesheet${month ? `?month=${encodeURIComponent(month)}` : ""}`),

  /** Absolute URL for a stored selfie, for use in <Image source={{ uri }} />. */
  photoUrl: (key: string) =>
    `${API_BASE_URL}/api/attendance/photo?key=${encodeURIComponent(key)}`,

  photoHeaders: () => headers(),
};

// ---------------------------------------------------------------- types

export type BirthdayPerson = { id: string; name: string; jobRole: string; office: string };

export type Branch = {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  radius: number;
};

export type PunchStatus = {
  employeeId: string;
  workStartTime: string;
  workEndTime: string;
  office: string;
  punchIn: { time: string; office: string; photoKey: string } | null;
  punchOut: { time: string; office: string; photoKey: string } | null;
  punches: Array<{ type: "IN" | "OUT"; time: string; office: string; photoKey: string }>;
  flexibleHours: boolean;
  rules: { gracePeriod: number; lunchBreakEnabled: boolean; lunchBreakMinHours: number };
  nextPunchType: "IN" | "OUT" | null;
  canPunchIn: boolean;
  canPunchOut: boolean;
};

export type HistoryRecord = {
  date: string;
  punchInTime: string | null;
  punchOutTime: string | null;
  duration: number | null;
  status: string;
  lateByMinutes: number | null;
  office: string | null;
  photoKeyIn: string | null;
  photoKeyOut: string | null;
};

export type HistoryResponse = {
  records: HistoryRecord[];
  totalDays: number;
  presentDays: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
};

export type RequestStatus = "pending" | "approved" | "rejected";

export type LeaveRequest = {
  id: string;
  leaveType: "sick" | "casual" | "earned";
  fromDate: string;
  toDate: string;
  reason: string;
  status: RequestStatus;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type MissPunchRequest = {
  id: string;
  date: string;
  punchType: "IN" | "OUT";
  requestedTime: string;
  reason: string;
  status: RequestStatus;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type Journal = {
  id: string;
  date: string;
  tasks: string;
  todos: string[];
};

export type TimesheetDay = {
  date: string;
  dayOfWeek: number;
  status: string;
  punchIn: string | null;
  punchOut: string | null;
  duration: number | null;
};

export type Timesheet = {
  month: string;
  days: TimesheetDay[];
  totalHoursWorked: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
};

export type Profile = {
  id: string;
  name: string;
  email: string;
  jobRole: string;
  mobileNumber: string;
  workStartTime: string;
  workEndTime: string;
  office: string;
  role: string;
  createdAt: string;
  /** "YYYY-MM-DD", or "" when no birthday has ever been recorded. */
  dateOfBirth: string;
  /** Self-edits already spent, 0-2. An admin's edits never count towards it. */
  profileEditCount: number;
  /** Math.max(0, 2 - profileEditCount), computed server-side. */
  editsRemaining: number;
};
