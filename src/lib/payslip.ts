/**
 * Payslip layout, ported from the web app (lib/payslip-layout.ts and
 * lib/amount-words.ts in mark_attendance) so the phone shows exactly the same
 * earnings, deductions and net pay as the employee's web panel and PDF.
 */
import type { Payslip, SalaryLine } from "../api/client";

export type PayslipRow = { label: string; note: string; amount: number };

/** 152300 → "1,52,300" (Indian grouping, done by hand: Hermes' Intl may lack en-IN). */
export function amountText(n: number): string {
  const neg = n < 0;
  const digits = String(Math.round(Math.abs(n)));
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${rest ? `${rest},` : ""}${last3}`;
}

/** "₹1,52,300" */
export const rupees = (n: number) => `₹${amountText(n)}`;

const hm = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;

function noteFor(l: SalaryLine): string {
  if (l.note) return l.note;
  const arrow = l.detail.lastIndexOf("→");
  return (arrow >= 0 ? l.detail.slice(arrow + 1) : l.detail).trim();
}

export function payslipTable(slip: Payslip) {
  let earnings: PayslipRow[];
  let deductions: PayslipRow[];
  if (slip.isFlexible) {
    earnings = [{ label: "Hourly pay", note: `${hm(slip.attendance.workedMinutes)} × ${rupees(slip.pay.hourlyRate)}/hour`, amount: slip.pay.netPay }];
    deductions = [];
  } else {
    earnings = slip.pay.lines
      .filter((l) => l.kind === "base" || l.kind === "extra")
      .map((l) => ({ label: l.label, note: l.kind === "base" ? "Fixed pay for the month" : noteFor(l), amount: l.amount }));
    deductions = slip.pay.lines
      .filter((l) => l.kind === "deduction")
      .map((l) => ({ label: l.label, note: noteFor(l), amount: -l.amount }));
  }
  const totalEarnings = earnings.reduce((s, r) => s + r.amount, 0);
  const totalDeductions = deductions.reduce((s, r) => s + r.amount, 0);
  return {
    earnings,
    deductions,
    totalEarnings,
    totalDeductions,
    netPay: slip.pay.netPay,
    netPayWords: `${amountInWords(slip.pay.netPay)} Rupees Only`,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function payslipDetails(slip: Payslip) {
  const fmtDate = (d?: string) => {
    if (!d) return "-";
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return d;
    return `${String(day).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
  };
  const worked = slip.attendance.workedDays ?? slip.attendance.presentDays;
  const rows: [string, string][] = [
    ["Employee Name", slip.employee.name],
    ["Employee ID", slip.employee.id],
    ["Designation", slip.employee.jobRole || "-"],
    ["Department", slip.employee.department || "-"],
    ["Pay Period", slip.monthLabel],
    slip.isFlexible ? ["Hours Worked", hm(slip.attendance.workedMinutes)] : ["Worked Days", `${worked} of ${slip.attendance.daysInMonth}`],
    ["Date of Joining", fmtDate(slip.employee.dateOfJoining)],
    ["Branch", slip.employee.office || "-"],
  ];
  return rows;
}

// ── Amount in words (Indian system) ──

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

export function amountInWords(amount: number): string {
  let n = Math.floor(Math.abs(amount));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${amountInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}
