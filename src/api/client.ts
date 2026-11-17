import { readAsStringAsync, EncodingType } from "expo-file-system";
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
 * Build a multipart/form-data body as raw bytes, with one JPEG file part.
 *
 * Why not FormData: Expo SDK 57 replaces the global fetch with expo/fetch,
 * which checks `body instanceof ReadableStream` before it handles FormData.
 * ReadableStream is not defined on Hermes (Android), so any FormData upload
 * throws "Property 'ReadableStream' doesn't exist". A Uint8Array body is
 * handled before that check. Reading the file eagerly also avoids the OkHttp
 * HTTP/2 "stream was reset: NO_ERROR" seen when streaming a File lazily.
 */
async function multipart(
  fields: Record<string, string>,
  file: { field: string; filename: string; uri: string },
): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string }> {
  const uri = file.uri.startsWith("file://") ? file.uri : `file://${file.uri}`;
  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  const fileBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const boundary = `----attendly${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const enc = new TextEncoder();
  let head = "";
  for (const [name, value] of Object.entries(fields)) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  head +=
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`;
  const headBytes = enc.encode(head);
  const tailBytes = enc.encode(`\r\n--${boundary}--\r\n`);

  const body = new Uint8Array(headBytes.length + fileBytes.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(fileBytes, headBytes.length);
  body.set(tailBytes, headBytes.length + fileBytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** One-shot launch prefetch of /api/attendance/status (see api.prefetchStatus). */
let statusPrefetch: { promise: Promise<PunchStatus>; at: number } | null = null;
const PREFETCH_MAX_AGE_MS = 15_000;

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

// ---------------------------------------------------------------- auth

export type RequestOtpResult = { ok: true; employeeId: string; employeeName: string };
export type VerifyOtpResult = { role: string; name: string; token: string; employeeId: string };

export const api = {
  requestOtp: (mobileNumber: string): Promise<RequestOtpResult> =>
    postJson("/api/auth/request-otp", { mobileNumber }),

  verifyOtp: (employeeId: string, otpCode: string): Promise<VerifyOtpResult> =>
    postJson("/api/auth/verify-otp", { employeeId, otpCode }),

  sessionCheck: (): Promise<{ valid: boolean; role: string }> =>
    getJson("/api/auth/session-check"),

  logout: () => request("/api/auth/logout", { method: "POST", headers: headers() }),

  // ------------------------------------------------------------ attendance

  status: (): Promise<PunchStatus> => {
    // Hand over the launch prefetch once, if it is still fresh
    const pre = statusPrefetch;
    statusPrefetch = null;
    if (pre && Date.now() - pre.at < PREFETCH_MAX_AGE_MS) return pre.promise;
    return getJson("/api/attendance/status");
  },

  /**
   * Start loading Today's data during launch, while the splash is still up,
   * so the Today screen's first `status()` call gets it without another wait.
   */
  prefetchStatus: () => {
    const promise: Promise<PunchStatus> = getJson("/api/attendance/status");
    promise.catch(() => {}); // the screen sees (and handles) any error when it takes it
    statusPrefetch = { promise, at: Date.now() };
  },

  history: (month?: string): Promise<HistoryResponse> =>
    getJson(`/api/attendance/history${month ? `?month=${encodeURIComponent(month)}` : ""}`),

  branches: (): Promise<{ branches: Branch[] }> => getJson("/api/branches/active"),

  profile: async (): Promise<{ profile: Profile }> => {
    const data = await getJson("/api/employee/profile");
    if (data?.profile?.photoUrl) {
      data.profile.photoUrl = `${API_BASE_URL}${data.profile.photoUrl}`;
    }
    return data;
  },

  /**
   * Upload a new profile photo. Follows the same multipart pattern as punch.
   * Server should store the image and return the public URL.
   */
  uploadProfilePhoto: async (uri: string): Promise<{ photoUrl: string }> => {
    const { body, contentType } = await multipart({}, { field: "photo", filename: "avatar.jpg", uri });
    const data = await request("/api/employee/profile/photo", {
      method: "POST",
      headers: headers({ "Content-Type": contentType }),
      body,
    });
    // Server returns a relative path; make it absolute and bust the HTTP cache
    // so the new photo is fetched immediately even if the old one was cached.
    return { photoUrl: `${API_BASE_URL}${data.photoUrl}?t=${Date.now()}` };
  },

  /** Remove the profile photo from the server. */
  removeProfilePhoto: () =>
    request("/api/employee/profile/photo", { method: "DELETE", headers: headers() }),

  /**
   * The punch endpoint takes multipart form data, not JSON, and rejects a photo
   * over 5 MB or missing coordinates. Callers must compress first.
   */
  punch: async (args: {
    photoUri: string;
    punchType: "IN" | "OUT";
    latitude: number;
    longitude: number;
    sessionNumber: number;
  }) => {
    const { body, contentType } = await multipart(
      {
        punchType: args.punchType,
        latitude: String(args.latitude),
        longitude: String(args.longitude),
        sessionNumber: String(args.sessionNumber),
      },
      { field: "photo", filename: "selfie.jpg", uri: args.photoUri },
    );
    return request("/api/attendance", {
      method: "POST",
      headers: headers({ "Content-Type": contentType }),
      body,
    });
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

  /** Withdraw your own leave request while it's still pending. */
  withdrawLeave: (id: string) =>
    request("/api/leave", {
      method: "DELETE",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id }),
    }),

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

  // ------------------------------------------------------------ payslips

  /** Months with a published payslip for the signed-in employee, newest first. */
  payslips: (): Promise<{ payslips: PayslipSummary[] }> => getJson("/api/payslips"),

  payslip: (month: string): Promise<{ payslip: Payslip }> =>
    getJson(`/api/payslips?month=${encodeURIComponent(month)}`),

  timesheet: (month?: string): Promise<Timesheet> =>
    getJson(`/api/attendance/timesheet${month ? `?month=${encodeURIComponent(month)}` : ""}`),

  /** Absolute URL for a stored selfie, for use in <Image source={{ uri }} />. */
  photoUrl: (key: string) =>
    `${API_BASE_URL}/api/attendance/photo?key=${encodeURIComponent(key)}`,

  photoHeaders: () => headers(),
};

// ---------------------------------------------------------------- types

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
  /** `pending` = from a miss-punch request still waiting for admin approval (no photo/office yet) */
  punchIn: { time: string; office: string; photoKey: string; pending?: boolean } | null;
  punchOut: { time: string; office: string; photoKey: string; pending?: boolean } | null;
  punches: Array<{ type: "IN" | "OUT"; time: string; office: string; photoKey: string; pending?: boolean }>;
  /** Miss-punch requests for today that already count as punches while awaiting approval */
  pendingPunches?: Array<{ type: "IN" | "OUT"; time: string }>;
  flexibleHours: boolean;
  /** Admin allowed this employee to punch outside the office geo-fence */
  punchAnywhere?: boolean;
  rules: { gracePeriod: number; lunchBreakEnabled: boolean; lunchBreakMinHours: number };
  nextPunchType: "IN" | "OUT" | null;
  canPunchIn: boolean;
  canPunchOut: boolean;
};

export type SessionInfo = {
  inTime: string;
  outTime: string | null;
  durationMinutes: number | null;
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
  sessions?: SessionInfo[];
  /** Punched out but no punch-in that day */
  missedPunchIn?: boolean;
  /** Punched in but never punched out */
  missedPunchOut?: boolean;
  holidayName?: string;
  /** Half day because of coming in too late (lateByMinutes says how late) */
  lateHalfDay?: boolean;
  /** Approved leave that the leave policy doesn't pay for (deducted from salary) */
  unpaidLeave?: boolean;
};

export type HistoryResponse = {
  records: HistoryRecord[];
  totalDays: number;
  presentDays: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  isFlexible?: boolean;
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
  sessions?: SessionInfo[];
  holidayName?: string;
  /** Half day because of coming in too late */
  lateHalfDay?: boolean;
  /** Approved leave that the leave policy doesn't pay for (deducted from salary) */
  unpaidLeave?: boolean;
};

export type Timesheet = {
  month: string;
  days: TimesheetDay[];
  totalHoursWorked: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  /** Of the leave days, how many are unpaid */
  unpaidLeaveDays?: number;
  isFlexible?: boolean;
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
  /** Set by the server after a successful photo upload. */
  photoUrl?: string | null;
};

// ---------------------------------------------------------------- payslips

export type PayslipSummary = { month: string; monthLabel: string; netPay: number; publishedAt: string };

export type SalaryLine = {
  label: string;
  detail: string;
  /** Short "how it was worked out" text (older payslips only have `detail`) */
  note?: string;
  amount: number;
  kind: "base" | "deduction" | "extra" | "info";
};

/** Frozen copy of a month's salary, as published by the admin. */
export type Payslip = {
  month: string;
  monthLabel: string;
  publishedAt: string;
  company?: { name: string; address: string };
  employee: { id: string; name: string; jobRole: string; department: string; office: string; shift: string; dateOfJoining?: string };
  isFlexible: boolean;
  attendance: {
    daysInMonth: number;
    workedDays?: number;
    presentDays: number;
    halfDays: number;
    absentDays: number;
    lateDays: number;
    leaveDays: number;
    unpaidLeaveDays: number;
    weeklyOffs: number;
    holidays: number;
    weekOffWorkedDays: number;
    workedMinutes: number;
    overtimeMinutes: number;
  };
  pay: {
    monthlySalary: number;
    perDayRate: number;
    hourlyRate: number;
    lines: SalaryLine[];
    deductions: number;
    additions: number;
    netPay: number;
  };
};
