import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError } from "../src/api/client";
import { AdminBranch, adminExtra, AttendanceRule, Department } from "../src/api/admin";
import { Button, Notice } from "../src/components/ui";
import {
  Avatar,
  DetailRow,
  EmptyState,
  FormField,
  FormSwitch,
  IconButton,
  Loading,
  Row,
  ScreenHeader,
  SectionHeader,
  Sheet,
  SheetAction,
  StatStrip,
  StatusPill,
} from "../src/components/adminui";
import { colors, radius, spacing, type } from "../src/theme";
import { acquireLocation, formatDate } from "../src/lib/punch";

/**
 * Office settings: branches, departments, global attendance rules, admins.
 *
 * This is the one admin screen with no single dataset behind it, so it reads as
 * four small screens stacked in one scroll. Each section owns its fetch, its
 * error and its empty state — a dead /api/departments must not blank out the
 * branch list the admin actually came here to fix.
 *
 * Neither branches nor departments have a DELETE route on the server, so
 * deactivation is the only removal offered. Rows stay quiet: a name, a soft
 * line, a status pill, and every action one tap away in a sheet.
 */

const MIN_RADIUS = 50; // PATCH 400s below this; POST silently clamps up to it
const DEFAULT_RADIUS = "200";
const RULE_DEBOUNCE_MS = 600;
const RULE_STEP = 0.5;

// What the server falls back to when no label was ever set. Shown as the
// placeholder so a blank field reads as "the default", not as "nothing".
const DEFAULT_FORM_LABEL = "Employee information form";
const FORM_LABEL_MAX = 80; // the server trims and caps at this

// Module-level so each section hook keeps a stable `load` identity.
const fetchBranches = () => adminExtra.branches();
const fetchDepartments = () => adminExtra.departments();
const fetchRules = () => adminExtra.rules();
const fetchAdmins = () => adminExtra.employees("admin");
const fetchAppSettings = () => adminExtra.appSettings();

type Section<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Never rejects — a failure is state, not a throw. Resolves false when the
   *  fetch missed, so a caller that just wrote can tell fresh data from stale. */
  load: () => Promise<boolean>;
};

/** One section's fetch, deliberately isolated from its neighbours'. */
function useSection<T>(fetcher: () => Promise<T>, fallback: string): Section<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetcher());
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fallback);
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetcher, fallback]);

  return { data, error, loading, load };
}

function activePill(active: boolean): { label: string; fg: string; bg: string } {
  return active
    ? { label: "Active", fg: colors.ok, bg: colors.okTint }
    : { label: "Inactive", fg: colors.muted, bg: colors.bg };
}

/**
 * createdAt is SQLite's CURRENT_TIMESTAMP — "2026-08-22 21:40:11", in UTC. Read
 * as-is it lands on the wrong calendar day for anything written after 6:30pm
 * IST, so convert to the device's day first and let formatDate render it.
 */
function addedOn(raw: string | null | undefined): string {
  if (!raw) return "—";
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return formatDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
}

// ---------------------------------------------------------------- branches

type BranchForm = { name: string; latitude: string; longitude: string; radius: string };

const EMPTY_BRANCH: BranchForm = {
  name: "",
  latitude: "",
  longitude: "",
  radius: DEFAULT_RADIUS,
};

/** Checked here because PATCH rejects a sub-50m radius while POST quietly clamps. */
function validateBranch(f: BranchForm): string | null {
  if (f.name.trim().length < 2) return "Branch name needs at least 2 characters.";

  const lat = f.latitude.trim();
  const latNum = Number(lat);
  if (!lat || !Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
    return "Latitude must be a number between -90 and 90.";
  }

  const lon = f.longitude.trim();
  const lonNum = Number(lon);
  if (!lon || !Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
    return "Longitude must be a number between -180 and 180.";
  }

  const rad = f.radius.trim();
  const radNum = Math.round(Number(rad));
  if (!rad || !Number.isFinite(radNum) || radNum < MIN_RADIUS) {
    return `Radius must be at least ${MIN_RADIUS} metres.`;
  }
  return null;
}

type BranchSheetState =
  | { mode: "actions"; branch: AdminBranch }
  | { mode: "form"; branch: AdminBranch | null };

type DeptSheetState =
  | { mode: "actions"; dept: Department }
  | { mode: "form"; dept: Department | null };

function branchSheetTitle(s: BranchSheetState | null): string {
  if (!s) return "";
  if (s.mode === "form") return s.branch ? "Edit branch" : "Add branch";
  return s.branch.name;
}

function deptSheetTitle(s: DeptSheetState | null): string {
  if (!s) return "";
  if (s.mode === "form") return s.dept ? "Rename department" : "Add department";
  return s.dept.name;
}

// ---------------------------------------------------------------- rules

function ruleAsNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Steps of 0.5, never below zero; ".0" trimmed so 2 stays "2", not "2.0". */
function steppedValue(current: number, delta: number): string {
  const next = Math.max(0, Math.round((current + delta) * 2) / 2);
  return Number.isInteger(next) ? String(next) : next.toFixed(1);
}

// ------------------------------------------------------------ form link

/** Unsaved edits only. Null means "whatever the server last said", so a refetch
 *  on refocus can't overwrite a link the admin is halfway through typing. */
type FormLinkDraft = { url: string; label: string };

/**
 * The same test the Profile screen applies before it will render the link, run
 * here so a dead link is refused at the point it is typed.
 *
 * The server's check — `new URL(value)` with an http/https protocol — is looser
 * than it reads: "https:forms.gle/x" and "https:/forms.gle/x" both parse with
 * protocol "https:" and save cleanly, and then match no employee's `^https?://`
 * test and appear on nobody's profile. A missing slash must not cost the office
 * a link that looks saved. Blank passes: that is how the link is cleared.
 */
function formLinkProblem(url: string): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return "The link must start with http:// or https://.";
  // A raw space survives the server's parse but not every phone's browser.
  if (/\s/.test(url)) return "The link can't contain spaces.";
  return null;
}

// ---------------------------------------------------------------- screen

export default function AdminSettingsScreen() {
  const router = useRouter();

  const branches = useSection(fetchBranches, "Couldn't load branch locations.");
  const departments = useSection(fetchDepartments, "Couldn't load departments.");
  const rules = useSection(fetchRules, "Couldn't load attendance rules.");
  const admins = useSection(fetchAdmins, "Couldn't load admin users.");
  const appSettings = useSection(fetchAppSettings, "Couldn't load the employee form link.");

  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [branchSheet, setBranchSheet] = useState<BranchSheetState | null>(null);
  const [branchForm, setBranchForm] = useState<BranchForm>(EMPTY_BRANCH);

  const [deptSheet, setDeptSheet] = useState<DeptSheetState | null>(null);
  const [deptName, setDeptName] = useState("");

  // Optimistic value per rule while its debounced write is in flight.
  const [ruleDraft, setRuleDraft] = useState<Record<string, string>>({});
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);
  const [ruleWriteError, setRuleWriteError] = useState<string | null>(null);
  const ruleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Form link: its own draft, busy flag and error, kept out of `busy`/`sheetError`
  // so a rejected URL can't wedge a branch sheet shut.
  const [linkDraft, setLinkDraft] = useState<FormLinkDraft | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSaved, setLinkSaved] = useState(false);

  const branchLoad = branches.load;
  const deptLoad = departments.load;
  const rulesLoad = rules.load;
  const adminsLoad = admins.load;
  const appSettingsLoad = appSettings.load;

  useFocusEffect(
    useCallback(() => {
      void branchLoad();
      void deptLoad();
      void rulesLoad();
      void adminsLoad();
      void appSettingsLoad();
    }, [branchLoad, deptLoad, rulesLoad, adminsLoad, appSettingsLoad]),
  );

  useEffect(() => {
    const timers = ruleTimers.current;
    return () => {
      Object.keys(timers).forEach((id) => clearTimeout(timers[id]));
    };
  }, []);

  async function refreshAll() {
    setRefreshing(true);
    await Promise.all([branchLoad(), deptLoad(), rulesLoad(), adminsLoad(), appSettingsLoad()]);
    setRefreshing(false);
  }

  // -------------------------------------------------------------- branches

  function openBranchForm(branch: AdminBranch | null) {
    setSheetError(null);
    setBranchForm(
      branch
        ? {
            name: branch.name,
            latitude: branch.latitude,
            longitude: branch.longitude,
            radius: String(branch.radius || DEFAULT_RADIUS),
          }
        : EMPTY_BRANCH,
    );
    setBranchSheet({ mode: "form", branch });
  }

  async function useCurrentLocation() {
    setBusy("locate");
    setSheetError(null);
    try {
      const fix = await acquireLocation();
      setBranchForm((f) => ({
        ...f,
        latitude: fix.latitude.toFixed(6),
        longitude: fix.longitude.toFixed(6),
      }));
    } catch (e) {
      // acquireLocation throws PunchPrepError, whose message is written to show.
      setSheetError(e instanceof Error ? e.message : "Couldn't get a location fix.");
    } finally {
      setBusy(null);
    }
  }

  async function saveBranch() {
    if (!branchSheet || branchSheet.mode !== "form") return;

    const problem = validateBranch(branchForm);
    if (problem) {
      setSheetError(problem);
      return;
    }

    const body = {
      name: branchForm.name.trim(),
      latitude: branchForm.latitude.trim(),
      longitude: branchForm.longitude.trim(),
      radius: Math.round(Number(branchForm.radius.trim())),
    };
    const existing = branchSheet.branch;

    setBusy("branch-save");
    setSheetError(null);
    try {
      if (existing) await adminExtra.updateBranch(existing.id, body);
      else await adminExtra.createBranch(body);
      await branchLoad();
      setBranchSheet(null);
    } catch (e) {
      setSheetError(
        e instanceof ApiError
          ? e.message
          : existing
            ? "Couldn't save the branch."
            : "Couldn't create the branch.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleBranch(branch: AdminBranch) {
    setBusy("branch-active");
    setSheetError(null);
    try {
      await adminExtra.updateBranch(branch.id, { active: !branch.active });
      await branchLoad();
      setBranchSheet(null);
    } catch (e) {
      setSheetError(
        e instanceof ApiError
          ? e.message
          : `Couldn't ${branch.active ? "deactivate" : "activate"} ${branch.name}.`,
      );
    } finally {
      setBusy(null);
    }
  }

  // ----------------------------------------------------------- departments

  function openDeptForm(dept: Department | null) {
    setSheetError(null);
    setDeptName(dept ? dept.name : "");
    setDeptSheet({ mode: "form", dept });
  }

  async function saveDept() {
    if (!deptSheet || deptSheet.mode !== "form") return;

    const name = deptName.trim();
    if (name.length < 2) {
      setSheetError("Department name needs at least 2 characters.");
      return;
    }
    const existing = deptSheet.dept;

    setBusy("dept-save");
    setSheetError(null);
    try {
      if (existing) await adminExtra.updateDepartment(existing.id, { name });
      else await adminExtra.createDepartment(name);
      await deptLoad();
      setDeptSheet(null);
    } catch (e) {
      setSheetError(
        e instanceof ApiError
          ? e.message
          : existing
            ? "Couldn't rename the department."
            : "Couldn't create the department.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleDept(dept: Department) {
    setBusy("dept-active");
    setSheetError(null);
    try {
      await adminExtra.updateDepartment(dept.id, { active: !dept.active });
      await deptLoad();
      setDeptSheet(null);
    } catch (e) {
      setSheetError(
        e instanceof ApiError
          ? e.message
          : `Couldn't ${dept.active ? "deactivate" : "activate"} ${dept.name}.`,
      );
    } finally {
      setBusy(null);
    }
  }

  // ----------------------------------------------------------------- rules

  const commitRule = useCallback(
    async (ruleId: string, value: string) => {
      setRuleBusy(ruleId);
      setRuleWriteError(null);
      try {
        // Always a string on the wire — "true"/"false" for the boolean rules.
        await adminExtra.updateRule(ruleId, value);
      } catch (e) {
        setRuleWriteError(e instanceof ApiError ? e.message : "Couldn't save that rule.");
      }
      // The web swallows both the failure and this refetch. Here the refetch is
      // what puts the row back in step with the server either way, so it runs
      // before the optimistic draft is dropped and no stale value flashes.
      await rulesLoad();
      setRuleDraft((prev) => {
        const next = { ...prev };
        delete next[ruleId];
        return next;
      });
      // Only stand down if this rule is still the one showing as busy: a switch
      // and a stepper can be in flight together, and clearing the flag flat
      // would re-enable the other rule's buttons mid-write.
      setRuleBusy((cur) => (cur === ruleId ? null : cur));
    },
    [rulesLoad],
  );

  const scheduleRule = useCallback(
    (ruleId: string, value: string, delay: number) => {
      const pending = ruleTimers.current[ruleId];
      if (pending) clearTimeout(pending);
      ruleTimers.current[ruleId] = setTimeout(() => {
        delete ruleTimers.current[ruleId];
        void commitRule(ruleId, value);
      }, delay);
    },
    [commitRule],
  );

  function stepRule(rule: AttendanceRule, delta: number) {
    const current = ruleAsNumber(ruleDraft[rule.id] ?? rule.defaultValue);
    const value = steppedValue(current, delta);
    setRuleDraft((prev) => ({ ...prev, [rule.id]: value }));
    scheduleRule(rule.id, value, RULE_DEBOUNCE_MS);
  }

  function setRuleFlag(rule: AttendanceRule, on: boolean) {
    const value = on ? "true" : "false";
    setRuleDraft((prev) => ({ ...prev, [rule.id]: value }));
    scheduleRule(rule.id, value, 0); // one deliberate tap — nothing to debounce
  }

  // ------------------------------------------------------------- form link

  const savedLink = appSettings.data?.settings;
  const savedLabel = savedLink?.employeeFormLabel ?? "";
  const linkUrl = linkDraft?.url ?? savedLink?.employeeFormUrl ?? "";
  // The server answers with its own default whenever no label was ever set, so
  // echoing that back would fill the box with words nobody typed and the
  // placeholder would never show. Blank means the same thing and round-trips:
  // saving it sends "", which the server reads as "use the default" again.
  const linkLabel = linkDraft?.label ?? (savedLabel === DEFAULT_FORM_LABEL ? "" : savedLabel);

  function editLink(patch: Partial<FormLinkDraft>) {
    setLinkSaved(false);
    // The rejection named the old text. Once that text is gone, so is the line.
    setLinkError(null);
    setLinkDraft((prev) => ({ ...(prev ?? { url: linkUrl, label: linkLabel }), ...patch }));
  }

  async function saveFormLink() {
    const url = linkUrl.trim();
    const problem = formLinkProblem(url);
    if (problem) {
      setLinkSaved(false);
      setLinkError(problem);
      return;
    }

    setLinkBusy(true);
    setLinkError(null);
    setLinkSaved(false);
    try {
      await adminExtra.updateAppSettings({
        employeeFormUrl: url,
        employeeFormLabel: linkLabel.trim(),
      });
      // Refetch before dropping the draft, as the rules section does, so the
      // saved text stays on screen instead of flashing the pre-save value. If
      // that refetch misses, the draft is what is holding the saved text — drop
      // it then and the field silently rewinds to the link that was replaced.
      const reloaded = await appSettingsLoad();
      if (reloaded) setLinkDraft(null);
      setLinkSaved(true);
    } catch (e) {
      // A rejected link comes back as a 400 that already says what's wrong
      // ("Enter a valid http(s) link.") — show that, not a generic line.
      setLinkError(e instanceof ApiError ? e.message : "Couldn't save the employee form link.");
    } finally {
      setLinkBusy(false);
    }
  }

  // ------------------------------------------------------------------ view

  // A sheet stays put while a write is in flight, but "locate" is only filling
  // in a field and can take the full 20s GPS timeout — trapping the user behind
  // an undismissable sheet (back button included) for that long is not on.
  const writing = busy !== null && busy !== "locate";

  const branchList = branches.data?.branches ?? [];
  const deptList = departments.data?.departments ?? [];
  const ruleList = rules.data?.rules ?? [];
  const adminList = admins.data?.employees ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="Settings"
        subtitle="Branches, departments and attendance rules"
        onBack={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.brand} />
        }
      >
        <StatStrip
          stats={[
            { label: "Branches", value: branches.data ? branchList.length : "—" },
            { label: "Departments", value: departments.data ? deptList.length : "—" },
            { label: "Admins", value: admins.data ? adminList.length : "—" },
          ]}
        />

        {/* --------------------------------------------- branch locations */}
        <SectionHeader
          title="Branch locations"
          action={
            <IconButton
              name="add"
              onPress={() => openBranchForm(null)}
              accessibilityLabel="Add branch"
            />
          }
        />
        {branches.error ? <Notice>{branches.error}</Notice> : null}
        {branches.loading && !branches.data ? <Loading /> : null}
        {branchList.map((b) => {
          const pill = activePill(b.active);
          return (
            <Row
              key={b.id}
              title={b.name}
              subtitle={`${b.latitude}, ${b.longitude}`}
              meta={`${b.radius || DEFAULT_RADIUS}m radius`}
              right={<StatusPill label={pill.label} fg={pill.fg} bg={pill.bg} />}
              onPress={() => {
                setSheetError(null);
                setBranchSheet({ mode: "actions", branch: b });
              }}
            />
          );
        })}
        {branches.data && !branchList.length ? (
          <EmptyState
            icon="location-outline"
            title="No branches yet"
            body="Add one to switch on geo-fenced attendance."
          />
        ) : null}

        {/* -------------------------------------------------- departments */}
        <SectionHeader
          title="Departments"
          action={
            <IconButton
              name="add"
              onPress={() => openDeptForm(null)}
              accessibilityLabel="Add department"
            />
          }
        />
        {departments.error ? <Notice>{departments.error}</Notice> : null}
        {departments.loading && !departments.data ? <Loading /> : null}
        {deptList.map((d) => {
          const pill = activePill(d.active);
          return (
            <Row
              key={d.id}
              title={d.name}
              right={<StatusPill label={pill.label} fg={pill.fg} bg={pill.bg} />}
              onPress={() => {
                setSheetError(null);
                setDeptSheet({ mode: "actions", dept: d });
              }}
            />
          );
        })}
        {departments.data && !deptList.length ? (
          <EmptyState
            icon="business-outline"
            title="No departments yet"
            body="Departments group staff on the roster and in reports."
          />
        ) : null}

        {/* --------------------------------------------- attendance rules */}
        <SectionHeader title="Attendance rules" />
        <Text style={styles.note}>
          Global defaults for everyone. Per-employee overrides live in Staff.
        </Text>
        {rules.error ? <Notice>{rules.error}</Notice> : null}
        {ruleWriteError ? <Notice>{ruleWriteError}</Notice> : null}
        {rules.loading && !rules.data ? <Loading /> : null}
        {ruleList.map((rule) => {
          const value = ruleDraft[rule.id] ?? rule.defaultValue;
          const saving = ruleBusy === rule.id;

          if (rule.valueType === "boolean") {
            return (
              <FormSwitch
                key={rule.id}
                label={rule.label}
                hint={rule.description ?? undefined}
                value={value === "true"}
                onChange={(on) => setRuleFlag(rule, on)}
              />
            );
          }

          return (
            <View key={rule.id} style={styles.ruleRow}>
              <View style={styles.ruleText}>
                <Text style={styles.ruleLabel}>{rule.label}</Text>
                {rule.description ? <Text style={styles.ruleHint}>{rule.description}</Text> : null}
              </View>
              <View style={styles.stepper}>
                <IconButton
                  name="remove"
                  onPress={() => stepRule(rule, -RULE_STEP)}
                  disabled={saving || ruleAsNumber(value) <= 0}
                  accessibilityLabel={`Decrease ${rule.label}`}
                />
                <Text style={styles.stepValue}>{value}</Text>
                <IconButton
                  name="add"
                  onPress={() => stepRule(rule, RULE_STEP)}
                  disabled={saving}
                  accessibilityLabel={`Increase ${rule.label}`}
                />
              </View>
            </View>
          );
        })}
        {rules.data && !ruleList.length ? (
          <EmptyState icon="options-outline" title="No attendance rules configured" />
        ) : null}

        {/* -------------------------------------------- employee form link */}
        <SectionHeader title="Employee form link" />
        <Text style={styles.note}>
          One link for the whole office. It appears in every employee's profile. Clear it and it
          disappears from every profile.
        </Text>
        {appSettings.error ? <Notice>{appSettings.error}</Notice> : null}
        {linkError ? <Notice>{linkError}</Notice> : null}
        {linkSaved ? (
          <Notice tone="ok">
            {linkUrl
              ? "Saved. Every employee sees it in their profile."
              : "Cleared. The link is hidden for everyone."}
          </Notice>
        ) : null}
        {appSettings.loading && !appSettings.data ? <Loading /> : null}
        {appSettings.data ? (
          <View style={styles.linkCard}>
            <FormField
              label="Form link"
              hint="Must start with http:// or https://. Leave blank to hide it."
              value={linkUrl}
              onChangeText={(url) => editLink({ url })}
              placeholder="https://forms.gle/…"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <FormField
              label="Link text"
              hint="What employees tap. Blank falls back to the default."
              value={linkLabel}
              onChangeText={(label) => editLink({ label })}
              placeholder={DEFAULT_FORM_LABEL}
              maxLength={FORM_LABEL_MAX}
            />
            <Button
              label="Save form link"
              busy={linkBusy}
              disabled={!linkDraft}
              onPress={saveFormLink}
            />
          </View>
        ) : null}

        {/* ------------------------------------------------- admin users */}
        <SectionHeader title="Admin users" />
        <Text style={styles.note}>Admins are created through Staff, not here.</Text>
        {admins.error ? <Notice>{admins.error}</Notice> : null}
        {admins.loading && !admins.data ? <Loading /> : null}
        {adminList.map((a) => (
          <Row
            key={a.id}
            left={<Avatar name={a.name} size={36} />}
            title={a.name}
            subtitle={a.email}
            // Flagged only when it matters: an admin who has been switched off.
            right={
              a.active ? undefined : <StatusPill label="Inactive" fg={colors.muted} bg={colors.bg} />
            }
          />
        ))}
        {admins.data && !adminList.length ? (
          <EmptyState icon="shield-checkmark-outline" title="No admin users found" />
        ) : null}
      </ScrollView>

      {/* One sheet for branches. The actions view and the form swap content
          instead of stacking two modals, which Android handles badly. */}
      <Sheet
        visible={!!branchSheet}
        title={branchSheetTitle(branchSheet)}
        onClose={() => (writing ? null : setBranchSheet(null))}
      >
        {sheetError && branchSheet ? <Notice>{sheetError}</Notice> : null}

        {branchSheet?.mode === "actions" ? (
          <>
            <View style={styles.sheetCard}>
              <DetailRow label="Latitude" value={branchSheet.branch.latitude} />
              <DetailRow label="Longitude" value={branchSheet.branch.longitude} />
              <DetailRow
                label="Geo-fence"
                value={`${branchSheet.branch.radius || DEFAULT_RADIUS} m`}
              />
              <DetailRow label="Status" value={branchSheet.branch.active ? "Active" : "Inactive"} />
              <DetailRow label="Added" value={addedOn(branchSheet.branch.createdAt)} />
            </View>

            <SheetAction
              icon="create-outline"
              label="Edit branch"
              onPress={() => openBranchForm(branchSheet.branch)}
            />
            {branchSheet.branch.active ? (
              <SheetAction
                icon="close-circle-outline"
                label="Deactivate"
                tone={colors.danger}
                busy={busy === "branch-active"}
                onPress={() => toggleBranch(branchSheet.branch)}
              />
            ) : (
              <SheetAction
                icon="checkmark-circle-outline"
                label="Activate"
                tone={colors.ok}
                busy={busy === "branch-active"}
                onPress={() => toggleBranch(branchSheet.branch)}
              />
            )}
            <Text style={styles.sheetNote}>
              Branches can't be deleted. Deactivating takes one out of the geo-fence and leaves
              past punches intact.
            </Text>
          </>
        ) : null}

        {branchSheet?.mode === "form" ? (
          <>
            <FormField
              label="Branch name"
              required
              value={branchForm.name}
              onChangeText={(name) => setBranchForm((f) => ({ ...f, name }))}
              placeholder="e.g. Bhayandar Office"
              autoCapitalize="words"
            />
            <FormField
              label="Latitude"
              required
              value={branchForm.latitude}
              onChangeText={(latitude) => setBranchForm((f) => ({ ...f, latitude }))}
              placeholder="19.295200"
              // "numeric", not "decimal-pad": Android's decimal pad has no minus
              // key, so a southern/western coordinate would be untypeable.
              keyboardType="numeric"
            />
            <FormField
              label="Longitude"
              required
              value={branchForm.longitude}
              onChangeText={(longitude) => setBranchForm((f) => ({ ...f, longitude }))}
              placeholder="72.851000"
              keyboardType="numeric"
            />
            <SheetAction
              icon="locate-outline"
              label={busy === "locate" ? "Getting a GPS fix…" : "Use current location"}
              tone={colors.brand}
              busy={busy === "locate"}
              onPress={useCurrentLocation}
            />
            <FormField
              label="Geo-fence radius"
              required
              hint={`Metres from the pin. Minimum ${MIN_RADIUS}.`}
              value={branchForm.radius}
              onChangeText={(text) => setBranchForm((f) => ({ ...f, radius: text }))}
              placeholder={DEFAULT_RADIUS}
              keyboardType="number-pad"
              maxLength={6}
            />
            <Button
              label={branchSheet.branch ? "Save branch" : "Create branch"}
              busy={busy === "branch-save"}
              disabled={busy === "locate"}
              onPress={saveBranch}
            />
          </>
        ) : null}
      </Sheet>

      {/* Departments: the same two-mode sheet, one field. */}
      <Sheet
        visible={!!deptSheet}
        title={deptSheetTitle(deptSheet)}
        onClose={() => (writing ? null : setDeptSheet(null))}
      >
        {sheetError && deptSheet ? <Notice>{sheetError}</Notice> : null}

        {deptSheet?.mode === "actions" ? (
          <>
            <View style={styles.sheetCard}>
              <DetailRow label="Status" value={deptSheet.dept.active ? "Active" : "Inactive"} />
              <DetailRow label="Added" value={addedOn(deptSheet.dept.createdAt)} />
            </View>

            <SheetAction
              icon="create-outline"
              label="Rename"
              onPress={() => openDeptForm(deptSheet.dept)}
            />
            {deptSheet.dept.active ? (
              <SheetAction
                icon="close-circle-outline"
                label="Deactivate"
                tone={colors.danger}
                busy={busy === "dept-active"}
                onPress={() => toggleDept(deptSheet.dept)}
              />
            ) : (
              <SheetAction
                icon="checkmark-circle-outline"
                label="Activate"
                tone={colors.ok}
                busy={busy === "dept-active"}
                onPress={() => toggleDept(deptSheet.dept)}
              />
            )}
            <Text style={styles.sheetNote}>
              Departments can't be deleted. Deactivating keeps one off new staff records without
              touching the people already in it.
            </Text>
          </>
        ) : null}

        {deptSheet?.mode === "form" ? (
          <>
            <FormField
              label="Department name"
              required
              value={deptName}
              onChangeText={setDeptName}
              placeholder="e.g. Human Resources"
              autoCapitalize="words"
            />
            <Button
              label={deptSheet.dept ? "Save name" : "Create department"}
              busy={busy === "dept-save"}
              onPress={saveDept}
            />
          </>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  note: { ...type.small, color: colors.muted, fontSize: 12, lineHeight: 17 },

  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  ruleText: { flex: 1, gap: 2 },
  ruleLabel: { ...type.body, color: colors.ink, fontWeight: "600" },
  ruleHint: { ...type.small, color: colors.muted, fontSize: 12, lineHeight: 17 },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  stepValue: { ...type.heading, color: colors.ink, minWidth: 42, textAlign: "center" },

  linkCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },

  sheetCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetNote: { ...type.small, color: colors.muted, lineHeight: 19 },
});
