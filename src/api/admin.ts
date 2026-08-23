/**
 * Admin API surface.
 *
 * Every route here is gated by `requireApiRole("admin")` on the server — the one
 * exception is `appSettings`, a read any signed-in account may make, and it is
 * marked as such below. That gate sits on top of `getAppIdentity()`, which reads
 * `Authorization: Bearer` when there is no session cookie. So these work from the
 * app with the same token an admin sign-in returns; nothing on the server was
 * added for them.
 *
 * Types mirror what each route actually returns rather than a tidied-up shape,
 * so a change on the server shows up here as a type error instead of an
 * undefined at runtime.
 */
import { adminRequest } from "./client";

// ---------------------------------------------------------------- dashboard

export type AttendanceStatus =
  | "present"
  | "late"
  | "absent"
  | "not_marked"
  | "unpaid_holiday";

export type RosterPunch = {
  time: string;
  photoKey: string | null;
  source: string | null;
  office: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type RosterEmployee = {
  id: string;
  name: string;
  workStartTime: string;
  punchIn: RosterPunch | null;
  punchOut: RosterPunch | null;
  durationMinutes: number | null;
  status: AttendanceStatus;
  source: string | null;
};

export type DailyAttendance = {
  date: string;
  isHoliday: boolean;
  holidayType: string | null;
  employees: RosterEmployee[];
  summary: { total: number; checkedIn: number; absent: number };
};

// ---------------------------------------------------------------- requests

export type ReviewAction = "approved" | "rejected";

export type AdminLeaveRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: "sick" | "casual" | "earned";
  fromDate: string;
  toDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type AdminMissPunchRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  punchType: "IN" | "OUT";
  requestedTime: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type PendingOtp = {
  id: string;
  employeeId: string;
  employeeName: string;
  otpCode: string;
  createdAt: string;
  expiresAt: string;
};

export const adminApi = {
  /** Roster for one day. Admins are excluded server-side, by design. */
  dailyAttendance: (date: string): Promise<DailyAttendance> =>
    adminRequest(`/api/admin/daily-attendance?date=${encodeURIComponent(date)}`),

  markAttendance: (args: {
    employeeId: string;
    date: string;
    action: "present" | "absent" | "unpaid_holiday";
  }) => adminRequest("/api/admin/mark-attendance", { method: "POST", body: args }),

  /** Whole-office shortcut. The server only accepts these two actions. */
  markAll: (args: { date: string; action: "present" | "unpaid_holiday" }) =>
    adminRequest("/api/admin/mark-all", { method: "POST", body: args }),

  undoMark: (args: { employeeId: string; date: string }) =>
    adminRequest("/api/admin/undo-mark", { method: "POST", body: args }),

  leaves: (): Promise<{ requests: AdminLeaveRequest[] }> => adminRequest("/api/leave"),

  reviewLeave: (args: { requestId: string; action: ReviewAction; adminNote?: string }) =>
    adminRequest("/api/leave/review", { method: "PATCH", body: args }),

  missPunches: (): Promise<{ requests: AdminMissPunchRequest[] }> =>
    adminRequest("/api/miss-punch"),

  reviewMissPunch: (args: { requestId: string; action: ReviewAction; adminNote?: string }) =>
    adminRequest("/api/miss-punch/review", { method: "PATCH", body: args }),

  /** Pending login codes, so an admin can read one out without the dashboard. */
  otpRequests: (): Promise<{ otpRequests: PendingOtp[] }> =>
    adminRequest("/api/admin/otp-requests"),
};

// ---------------------------------------------------------------- staff

export type Employee = {
  id: string;
  name: string;
  email: string;
  role: "employee" | "admin";
  jobRole: string;
  mobileNumber: string;
  workStartTime: string;
  workEndTime: string;
  office: string;
  department: string;
  active: boolean;
  monthlySalary: number;
  flexibleHours: boolean;
  /** "YYYY-MM-DD", or null on a row whose birthday was never recorded. */
  dateOfBirth: string | null;
  /** Self-edits the employee has already spent of their two. */
  profileEditCount: number;
  createdAt: string;
};

/** Only the keys that changed need sending; PATCH applies them one by one. */
export type EmployeePatch = Partial<{
  name: string;
  email: string;
  password: string;
  jobRole: string;
  mobileNumber: string;
  workStartTime: string;
  workEndTime: string;
  office: string;
  department: string;
  monthlySalary: number;
  active: boolean;
  flexibleHours: boolean;
  /** "YYYY-MM-DD", or "" to clear it. The admin route only checks the shape, so
   *  an impossible day like "2026-02-31" is stored as sent — the caller does the
   *  calendar check (see dobProblem() on the employee form). */
  dateOfBirth: string;
  /** Gives an employee's self-edit allowance back. Clamped to 0..2 server-side. */
  profileEditCount: number;
}>;

export type NewEmployee = {
  name: string;
  email: string;
  password: string;
  jobRole?: string;
  mobileNumber?: string;
  workStartTime?: string;
  workEndTime?: string;
  office?: string;
  department?: string;
  flexibleHours?: boolean;
  /** "YYYY-MM-DD". Omit it rather than sending a blank. */
  dateOfBirth?: string;
  role?: "employee" | "admin";
};

export type AdminBranch = {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  radius: number;
  active: boolean;
  createdAt: string;
};

export type Department = { id: string; name: string; active: boolean; createdAt: string };

export type AttendanceRule = {
  id: string;
  label: string;
  description: string | null;
  valueType: "number" | "boolean";
  defaultValue: string;
};

export type EmployeeRule = {
  ruleId: string;
  label: string;
  description: string | null;
  valueType: "number" | "boolean";
  globalDefault: string;
  override: string | null;
  effectiveValue: string;
};

// ---------------------------------------------------------------- reports

export type DayStatus =
  | "present"
  | "late"
  | "absent"
  | "half-day"
  | "short-day"
  | "leave"
  | "holiday"
  | "sunday"
  | "sunday-worked"
  | "uh";

export type DailyDetail = {
  date: string;
  punchIn: string | null;
  punchOut: string | null;
  durationMinutes: number | null;
  breakMinutes: number | null;
  status: DayStatus;
};

export type ReportRow = {
  id: string;
  name: string;
  shift: string;
  jobRole: string;
  office: string;
  monthlySalary: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  shortDays: number;
  lateAbsentDays: number;
  lateDays: number;
  leaveDays: number;
  uhDays: number;
  weeklyOffs: number;
  holidayCount: number;
  attendancePct: number;
  totalWorkedMinutes: number;
  sundayWorkedDays: number;
  sundayBonus: number;
  perDayRate: number;
  deduction: number;
  netPay: number;
  dailyDetails: DailyDetail[];
};

export type PayrollRow = {
  id: string;
  name: string;
  monthlySalary: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  lateAbsentDays: number;
  lateDays: number;
  leaveDays: number;
  sundayWorkedDays: number;
  sundayBonus: number;
  deduction: number;
  netPay: number;
};

// ---------------------------------------------------------------- audit

export type Activity = {
  id: string;
  actionType: string;
  performedBy: string;
  performedByName: string;
  targetId: string | null;
  targetName: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
};

export type Journal = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  tasks: string;
  todos: string[];
  updatedAt: string;
};

export const adminExtra = {
  // staff
  employees: (role?: "admin"): Promise<{ employees: Employee[] }> =>
    adminRequest(`/api/employees${role ? `?role=${role}` : ""}`),

  createEmployee: (body: NewEmployee): Promise<{ id: string }> =>
    adminRequest("/api/employees", { method: "POST", body }),

  updateEmployee: (id: string, patch: EmployeePatch) =>
    adminRequest("/api/employees", { method: "PATCH", body: { id, ...patch } }),

  // settings
  branches: (): Promise<{ branches: AdminBranch[] }> => adminRequest("/api/branches"),

  createBranch: (body: { name: string; latitude: string; longitude: string; radius: number }) =>
    adminRequest("/api/branches", { method: "POST", body }),

  updateBranch: (
    id: string,
    patch: Partial<{ name: string; latitude: string; longitude: string; radius: number; active: boolean }>,
  ) => adminRequest("/api/branches", { method: "PATCH", body: { id, ...patch } }),

  departments: (): Promise<{ departments: Department[] }> => adminRequest("/api/departments"),

  createDepartment: (name: string) =>
    adminRequest("/api/departments", { method: "POST", body: { name } }),

  updateDepartment: (id: string, patch: Partial<{ name: string; active: boolean }>) =>
    adminRequest("/api/departments", { method: "PATCH", body: { id, ...patch } }),

  rules: (): Promise<{ rules: AttendanceRule[] }> => adminRequest("/api/admin/rules"),

  /** `defaultValue` is always a string on the wire, booleans included. */
  updateRule: (ruleId: string, defaultValue: string) =>
    adminRequest("/api/admin/rules", { method: "PATCH", body: { ruleId, defaultValue } }),

  employeeRules: (employeeId: string): Promise<{ employeeId: string; rules: EmployeeRule[] }> =>
    adminRequest(`/api/admin/employee-rules?employeeId=${encodeURIComponent(employeeId)}`),

  setEmployeeRule: (employeeId: string, ruleId: string, value: string) =>
    adminRequest("/api/admin/employee-rules", {
      method: "PUT",
      body: { employeeId, ruleId, value },
    }),

  clearEmployeeRule: (employeeId: string, ruleId: string) =>
    adminRequest("/api/admin/employee-rules", {
      method: "DELETE",
      body: { employeeId, ruleId },
    }),

  /** Office-wide, not per employee. Any signed-in identity may read this one. */
  appSettings: (): Promise<{
    settings: { employeeFormUrl: string; employeeFormLabel: string };
  }> => adminRequest("/api/app-settings"),

  /** Admin only. The URL is validated server-side; a bad one comes back as a 400
   *  whose message is written to show, so surface it rather than a generic line. */
  updateAppSettings: (body: { employeeFormUrl?: string; employeeFormLabel?: string }) =>
    adminRequest("/api/app-settings", { method: "PATCH", body }),

  // reports
  report: (month: string): Promise<{ month: string; workingDays: number; employees: ReportRow[] }> =>
    adminRequest(`/api/admin/reports?month=${encodeURIComponent(month)}`),

  payroll: (
    month: string,
  ): Promise<{ month: string; workingDays: number; totalHolidays: number; employees: PayrollRow[] }> =>
    adminRequest(`/api/admin/payroll?month=${encodeURIComponent(month)}`),

  // audit
  activityLog: (args: {
    page?: number;
    limit?: number;
    actionType?: string;
    search?: string;
  }): Promise<{ activities: Activity[]; total: number; page: number; pages: number }> => {
    const q = new URLSearchParams();
    q.set("page", String(args.page ?? 1));
    q.set("limit", String(args.limit ?? 30));
    if (args.actionType) q.set("actionType", args.actionType);
    if (args.search) q.set("search", args.search);
    return adminRequest(`/api/admin/activity-log?${q.toString()}`);
  },

  journals: (date: string): Promise<{ journals: Journal[] }> =>
    adminRequest(`/api/admin/journals?date=${encodeURIComponent(date)}`),
};
