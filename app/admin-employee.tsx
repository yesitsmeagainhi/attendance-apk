import React, { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError } from "../src/api/client";
import {
  adminExtra,
  AdminBranch,
  Department,
  Employee,
  EmployeePatch,
  NewEmployee,
} from "../src/api/admin";
import { Button, Muted, Notice } from "../src/components/ui";
import {
  DetailRow,
  EmptyState,
  FormField,
  FormSelect,
  FormSwitch,
  Loading,
  ScreenHeader,
  SectionHeader,
} from "../src/components/adminui";
import { colors, radius, spacing, type } from "../src/theme";

/**
 * Add / edit one staff account.
 *
 * A root stack route rather than a tab: it is a destination you push from the
 * staff list and pop off when you are done, and it owns the whole screen so the
 * keyboard has somewhere to go. The web dashboard does this in two near-identical
 * modals (AddEmployeeModal / EditEmployeeModal); here it is one form, because the
 * only real differences are the password rule and which endpoint gets called.
 */

type FormState = {
  name: string;
  jobRole: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  department: string;
  email: string;
  password: string;
  mobileNumber: string;
  workStartTime: string;
  workEndTime: string;
  office: string;
  monthlySalary: string;
  flexibleHours: boolean;
};

/** The same defaults the dashboard starts a new employee on. */
const BLANK: FormState = {
  name: "",
  jobRole: "",
  dobDay: "",
  dobMonth: "",
  dobYear: "",
  department: "",
  email: "",
  password: "",
  mobileNumber: "",
  workStartTime: "09:00",
  workEndTime: "18:00",
  office: "",
  monthlySalary: "",
  flexibleHours: false,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^\S+@\S+\.\S+$/;

const digitsOnly = (t: string): string => t.replace(/\D/g, "");

/** "25000" -> "₹25,000". No Intl here — Hermes ships without the full ICU data. */
function rupees(n: number): string {
  const whole = String(Math.max(0, Math.round(n)));
  return `₹${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Short month names for reading a birthday back. No Intl — see rupees() above. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Last day of a 1-based month, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const pad2 = (t: string): string => (t.length === 1 ? `0${t}` : t);

/** A stored birthday split into the three boxes. Older rows come back null. */
function splitDob(raw: string | null): { day: string; month: string; year: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw || "");
  if (!m) return { day: "", month: "", year: "" };
  return { year: m[1], month: m[2], day: m[3] };
}

/** The three boxes as the server's "YYYY-MM-DD", or "" for "not recorded". */
function joinDob(f: FormState): string {
  if (!f.dobDay && !f.dobMonth && !f.dobYear) return "";
  return `${f.dobYear}-${pad2(f.dobMonth)}-${pad2(f.dobDay)}`;
}

/** The stored value in the same shape, so an untouched birthday isn't re-sent. */
function normalizeDob(raw: string | null): string {
  const { day, month, year } = splitDob(raw);
  return year ? `${year}-${month}-${day}` : "";
}

/**
 * The server answers a bad birthday with a flat 400 ("Date of birth must be
 * YYYY-MM-DD.") only after the whole form has been filled in, and it does not
 * catch 31 February at all — so the real calendar check has to happen here.
 */
function dobProblem(f: FormState): string | null {
  const filled = [f.dobDay, f.dobMonth, f.dobYear].filter((part) => part.length > 0);
  if (filled.length === 0) return null; // blank is fine: birthday not recorded
  if (filled.length < 3) {
    return "Enter the date of birth as day, month and year — or clear all three.";
  }
  const year = parseInt(f.dobYear, 10);
  const month = parseInt(f.dobMonth, 10);
  const day = parseInt(f.dobDay, 10);
  const thisYear = new Date().getFullYear();
  if (f.dobYear.length !== 4 || year < 1900 || year > thisYear) {
    return `Enter the birth year as 4 digits between 1900 and ${thisYear}.`;
  }
  if (month < 1 || month > 12) return "The birth month must be between 1 and 12.";
  const last = daysInMonth(year, month);
  if (day < 1 || day > last) {
    return `${MONTHS[month - 1]} ${year} has only ${last} days — check the birth day.`;
  }
  return null;
}

/** "14 May 1990" — what the three boxes actually add up to. */
function prettyDob(f: FormState): string {
  return `${parseInt(f.dobDay, 10)} ${MONTHS[parseInt(f.dobMonth, 10) - 1]} ${f.dobYear}`;
}

export default function AdminEmployeeFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const editing = typeof id === "string" && id.length > 0;

  /** Pushed from the staff list normally, but a deep link arrives with no stack. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(admin)");
  }, [router]);

  const [form, setForm] = useState<FormState>(BLANK);
  const [original, setOriginal] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<AdminBranch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  /**
   * The office and department pickers are built from the two lists load() pulls.
   * If that call failed there is nothing to pick from, so the form has to stay
   * hidden behind Try again on the add route too — not just when an edit route
   * failed to find its employee.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Set once the POST succeeds, so a failed follow-up never creates a second account. */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    setLoadFailed(false);
    try {
      const [deptRes, branchRes] = await Promise.all([
        adminExtra.departments(),
        adminExtra.branches(),
      ]);
      const activeDepartments = deptRes.departments.filter((d) => d.active);
      const activeBranches = branchRes.branches.filter((b) => b.active);
      const firstOffice = activeBranches.length ? activeBranches[0].name : "";
      setDepartments(activeDepartments);
      setBranches(activeBranches);

      if (!editing) {
        setForm((f) => ({ ...f, office: f.office || firstOffice }));
        return;
      }

      const staff = await adminExtra.employees();
      let found = staff.employees.find((e) => e.id === id) ?? null;
      if (!found) {
        // /api/employees returns staff; an admin account only comes back when the
        // role filter asks for it, so an admin row from the staff list lands here.
        const admins = await adminExtra.employees("admin");
        found = admins.employees.find((e) => e.id === id) ?? null;
      }
      if (!found) {
        setMissing(true);
        return;
      }
      setOriginal(found);
      const dob = splitDob(found.dateOfBirth);
      setForm({
        name: found.name || "",
        jobRole: found.jobRole || "",
        dobDay: dob.day,
        dobMonth: dob.month,
        dobYear: dob.year,
        department: found.department || "",
        email: found.email || "",
        password: "",
        mobileNumber: digitsOnly(found.mobileNumber || ""),
        workStartTime: found.workStartTime || BLANK.workStartTime,
        workEndTime: found.workEndTime || BLANK.workEndTime,
        office: found.office || firstOffice,
        monthlySalary: found.monthlySalary ? String(found.monthlySalary) : "",
        flexibleHours: !!found.flexibleHours,
      });
    } catch (e) {
      setLoadFailed(true);
      setError(e instanceof ApiError ? e.message : "Couldn't load this employee form.");
    } finally {
      setLoading(false);
    }
  }, [editing, id]);

  useEffect(() => {
    load();
  }, [load]);

  // A department is optional, so the list carries an explicit "none" first.
  const departmentOptions = useMemo(
    () => [{ key: "", label: "—" }, ...departments.map((d) => ({ key: d.name, label: d.name }))],
    [departments],
  );
  const officeOptions = useMemo(
    () => branches.map((b) => ({ key: b.name, label: b.name })),
    [branches],
  );

  const salary = parseInt(form.monthlySalary, 10) || 0;

  /** Reads the three date boxes back in words, so a typo shows before saving. */
  const dobHint = useMemo(() => {
    if (!form.dobDay && !form.dobMonth && !form.dobYear) {
      return "Optional. This is what the office-wide birthday wish is built from.";
    }
    if (dobProblem(form)) return "Not a real date yet — day, month and year, like 14 / 05 / 1990.";
    return prettyDob(form);
  }, [form]);

  /** Returns the first problem in reading order, or null when the form is good. */
  function validate(): string | null {
    if (!form.name.trim()) return "Enter a full name for this employee.";
    const dob = dobProblem(form);
    if (dob) return dob;
    if (!EMAIL.test(form.email.trim())) return "Enter a valid email address.";
    if ((!editing || form.password.length > 0) && form.password.length < 4) {
      return "The password must be at least 4 characters.";
    }
    const mobile = digitsOnly(form.mobileNumber);
    if (mobile.length > 0 && mobile.length !== 10) {
      return "Enter a valid 10-digit mobile number.";
    }
    if (!TIME.test(form.workStartTime) || !TIME.test(form.workEndTime)) {
      return "Enter the shift times as HH:MM, like 09:00.";
    }
    if (form.workStartTime >= form.workEndTime) {
      return "OUT timing must be later than IN timing.";
    }
    return null;
  }

  async function onSubmit() {
    // An edit route whose load failed has no original record to patch. Without
    // this the save falls through to the create branch and POSTs a duplicate.
    if (editing && !original) {
      setError("This employee didn't load. Tap Try again before saving.");
      return;
    }
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    const mobile = digitsOnly(form.mobileNumber);
    const dateOfBirth = joinDob(form);
    // Which side of the create/salary boundary a failure lands on. `createdId`
    // is state, so it still reads null on the pass that sets it — this local is
    // what the catch below can trust.
    let accountExists = createdId !== null;
    try {
      if (editing && original) {
        // PATCH applies keys one at a time, so send only what actually moved —
        // that keeps the activity log honest about what an admin changed.
        const patch: EmployeePatch = {};
        const name = form.name.trim();
        const email = form.email.trim().toLowerCase();
        const jobRole = form.jobRole.trim();
        if (name !== original.name) patch.name = name;
        if (email !== (original.email || "").toLowerCase()) patch.email = email;
        if (jobRole !== (original.jobRole || "")) patch.jobRole = jobRole;
        // "" is a real value here — it clears a birthday recorded by mistake.
        if (dateOfBirth !== normalizeDob(original.dateOfBirth)) {
          patch.dateOfBirth = dateOfBirth;
        }
        if (form.department !== (original.department || "")) patch.department = form.department;
        if (mobile !== digitsOnly(original.mobileNumber || "")) patch.mobileNumber = mobile;
        if (form.workStartTime !== original.workStartTime) {
          patch.workStartTime = form.workStartTime;
        }
        if (form.workEndTime !== original.workEndTime) patch.workEndTime = form.workEndTime;
        if (form.office !== (original.office || "")) patch.office = form.office;
        if (salary !== (original.monthlySalary || 0)) patch.monthlySalary = salary;
        if (form.flexibleHours !== !!original.flexibleHours) {
          patch.flexibleHours = form.flexibleHours;
        }
        // A blank password means "keep the current one" — never send an empty string.
        if (form.password.length > 0) patch.password = form.password;

        if (Object.keys(patch).length === 0) {
          goBack();
          return;
        }
        await adminExtra.updateEmployee(original.id, patch);
      } else {
        let newId = createdId;
        if (!newId) {
          const body: NewEmployee = {
            name: form.name.trim(),
            email: form.email.trim().toLowerCase(),
            password: form.password,
            jobRole: form.jobRole.trim(),
            workStartTime: form.workStartTime,
            workEndTime: form.workEndTime,
            office: form.office,
            department: form.department,
            flexibleHours: form.flexibleHours,
          };
          if (mobile) body.mobileNumber = mobile;
          if (dateOfBirth) body.dateOfBirth = dateOfBirth;
          const created = await adminExtra.createEmployee(body);
          newId = created.id;
          setCreatedId(newId);
          accountExists = true;
        }
        // Server bug: POST /api/employees takes monthlySalary and silently drops it,
        // so every new employee lands on ₹0. This PATCH puts it back. Don't fold it
        // into the create — the salary would vanish and payroll would read zero.
        if (salary > 0) {
          await adminExtra.updateEmployee(newId, { monthlySalary: salary });
        }
      }
      goBack();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : editing
            ? "Couldn't save those changes."
            : accountExists
              ? "Couldn't save the monthly salary — the account itself is created."
              : "Couldn't create this employee.",
      );
    } finally {
      setSaving(false);
    }
  }

  /**
   * The form is only safe to show once its pickers have data — and, on an edit
   * route, once the employee itself is loaded.
   */
  const ready = !loadFailed && (!editing || original !== null);
  const title = editing ? "Edit employee" : "Add employee";
  const subtitle = editing
    ? original
      ? original.name
      : loading
        ? "Loading…"
        : "Not loaded"
    : "New staff account";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={title} subtitle={subtitle} onBack={saving ? undefined : goBack} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {error ? <Notice>{error}</Notice> : null}

          {createdId && !editing ? (
            <Notice tone="warn">
              The account is already created — only the monthly salary is left to save. Tap
              Add employee again to retry just that part.
            </Notice>
          ) : null}

          {loading ? <Loading /> : null}

          {!loading && missing ? (
            <EmptyState
              icon="person-outline"
              title="Employee not found"
              body="They may have been removed. Go back and pull the staff list to refresh it."
            />
          ) : null}

          {!loading && !missing && !ready ? (
            <View style={styles.submit}>
              <Button label="Try again" variant="secondary" onPress={load} />
            </View>
          ) : null}

          {!loading && !missing && ready ? (
            <>
              {original ? (
                <View style={styles.card}>
                  <DetailRow label="Employee ID" value={original.id} />
                  <DetailRow label="Status" value={original.active ? "Active" : "Inactive"} />
                </View>
              ) : null}

              <SectionHeader title="Details" />
              <View style={styles.group}>
                <FormField
                  label="Full name"
                  required
                  value={form.name}
                  onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
                  placeholder="e.g. Priya Shah"
                  autoCapitalize="words"
                  editable={!saving}
                />
                <FormField
                  label="Job role"
                  value={form.jobRole}
                  onChangeText={(t) => setForm((f) => ({ ...f, jobRole: t }))}
                  placeholder="e.g. Counsellor"
                  maxLength={80}
                  editable={!saving}
                />
                {/* No date picker module is installed. Three boxes rather than one
                    free-text field: each one fits a number pad, and nothing can
                    arrive as 14/05/1990 when the server only takes 1990-05-14. */}
                <View style={styles.dobBlock}>
                  <Text style={styles.dobLabel}>DATE OF BIRTH</Text>
                  <View style={styles.dobRow}>
                    <View style={styles.dobCell}>
                      <FormField
                        label="Day"
                        value={form.dobDay}
                        onChangeText={(t) =>
                          setForm((f) => ({ ...f, dobDay: digitsOnly(t).slice(0, 2) }))
                        }
                        placeholder="DD"
                        keyboardType="number-pad"
                        maxLength={2}
                        editable={!saving}
                      />
                    </View>
                    <View style={styles.dobCell}>
                      <FormField
                        label="Month"
                        value={form.dobMonth}
                        onChangeText={(t) =>
                          setForm((f) => ({ ...f, dobMonth: digitsOnly(t).slice(0, 2) }))
                        }
                        placeholder="MM"
                        keyboardType="number-pad"
                        maxLength={2}
                        editable={!saving}
                      />
                    </View>
                    <View style={styles.dobCell}>
                      <FormField
                        label="Year"
                        value={form.dobYear}
                        onChangeText={(t) =>
                          setForm((f) => ({ ...f, dobYear: digitsOnly(t).slice(0, 4) }))
                        }
                        placeholder="YYYY"
                        keyboardType="number-pad"
                        maxLength={4}
                        editable={!saving}
                      />
                    </View>
                  </View>
                  <Text style={styles.dobHint}>{dobHint}</Text>
                </View>
                <FormSelect
                  label="Department"
                  options={departmentOptions}
                  value={form.department}
                  onChange={(key) => setForm((f) => ({ ...f, department: key }))}
                />
              </View>

              <SectionHeader title="Sign in" />
              <View style={styles.group}>
                <FormField
                  label="Email address"
                  required
                  value={form.email}
                  onChangeText={(t) => setForm((f) => ({ ...f, email: t }))}
                  placeholder="priya@company.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!saving}
                />
                <FormField
                  label={editing ? "New password" : "Password"}
                  required={!editing}
                  hint={
                    editing
                      ? "Leave blank to keep current"
                      : "At least 4 characters. It is shown as you type so you can pass it on."
                  }
                  value={form.password}
                  onChangeText={(t) => setForm((f) => ({ ...f, password: t }))}
                  placeholder={editing ? "••••••••" : "Min 4 characters"}
                  // Adding: plain text, because the admin has to read it out to the
                  // new joiner. Editing: masked, it sits beside a live account.
                  secureTextEntry={editing}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!saving}
                />
              </View>

              <SectionHeader title="Contact and shift" />
              <View style={styles.group}>
                <FormField
                  label="Mobile number"
                  value={form.mobileNumber}
                  onChangeText={(t) =>
                    setForm((f) => ({ ...f, mobileNumber: digitsOnly(t).slice(0, 10) }))
                  }
                  placeholder="10-digit mobile number"
                  keyboardType="number-pad"
                  maxLength={10}
                  editable={!saving}
                />
                {/* No date/time picker module is installed, so the shift is typed. */}
                <View style={styles.timeRow}>
                  <View style={styles.timeCell}>
                    <FormField
                      label="IN timing"
                      value={form.workStartTime}
                      onChangeText={(t) => setForm((f) => ({ ...f, workStartTime: t }))}
                      placeholder="09:00"
                      maxLength={5}
                      autoCorrect={false}
                      editable={!saving}
                    />
                  </View>
                  <View style={styles.timeCell}>
                    <FormField
                      label="OUT timing"
                      value={form.workEndTime}
                      onChangeText={(t) => setForm((f) => ({ ...f, workEndTime: t }))}
                      placeholder="18:00"
                      maxLength={5}
                      autoCorrect={false}
                      editable={!saving}
                    />
                  </View>
                </View>
                {officeOptions.length ? (
                  <FormSelect
                    label="Office"
                    options={officeOptions}
                    value={form.office}
                    onChange={(key) => setForm((f) => ({ ...f, office: key }))}
                  />
                ) : (
                  <Muted>
                    No active office yet. Add a branch in Settings and set it here — without one
                    this employee has nowhere to punch in from.
                  </Muted>
                )}
              </View>

              <SectionHeader title="Pay and rules" />
              <View style={styles.group}>
                <FormField
                  label="Monthly salary"
                  hint={salary > 0 ? `${rupees(salary)} per month` : "Leave blank for none"}
                  value={form.monthlySalary}
                  onChangeText={(t) =>
                    setForm((f) => ({ ...f, monthlySalary: digitsOnly(t).slice(0, 9) }))
                  }
                  placeholder="e.g. 25000"
                  keyboardType="number-pad"
                  editable={!saving}
                />
                <FormSwitch
                  label="Flexible hours"
                  hint="Always marked present regardless of shift time"
                  value={form.flexibleHours}
                  onChange={(v) => setForm((f) => ({ ...f, flexibleHours: v }))}
                />
              </View>

              <View style={styles.submit}>
                <Button
                  label={editing ? "Save changes" : "Add employee"}
                  onPress={onSubmit}
                  busy={saving}
                />
              </View>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  group: { gap: spacing.lg },
  timeRow: { flexDirection: "row", gap: spacing.md },
  timeCell: { flex: 1 },
  dobBlock: { gap: spacing.sm },
  dobLabel: { ...type.label, color: colors.inkSoft },
  dobRow: { flexDirection: "row", gap: spacing.md },
  dobCell: { flex: 1 },
  dobHint: { ...type.small, color: colors.muted, fontSize: 12 },
  submit: { marginTop: spacing.md },
});
