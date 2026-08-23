import React, { useCallback, useMemo, useRef, useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, ApiError, Profile } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Muted, Notice } from "../../src/components/ui";
import {
  Avatar,
  DetailRow,
  EmptyState,
  FormField,
  Loading,
  Row,
  ScreenHeader,
  SectionHeader,
  Sheet,
} from "../../src/components/adminui";
import { NotificationBell } from "../../src/components/NotificationBell";
import { colors, radius, spacing, type } from "../../src/theme";
import { API_BASE_URL, IS_PRODUCTION_TARGET } from "../../src/config";

/** The allowance the server enforces, and the wording it uses once it is spent. */
const MAX_EDITS = 2;
const SPENT_MESSAGE =
  "You have used both of your profile edits. Please contact Head Office — Pooja Maam.";

/** The label the server falls back to, mirrored for a settings row that arrives empty. */
const DEFAULT_FORM_LABEL = "Employee information form";
/** The same cap the PATCH endpoint applies, so no row can stretch on its own. */
const MAX_FORM_LABEL_LENGTH = 80;

type FormLink = { url: string; label: string };

/**
 * The office-wide form link as this screen needs it, or null for "show nothing".
 *
 * Keeping the http(s) test here as well as on the server is deliberate: what
 * comes back is rendered as something 71 people are invited to tap, so a value
 * that is not plainly a web address is treated as no link at all rather than
 * handed to the phone to make sense of. PATCH is not the only way a row can
 * appear either — a direct sqlite write or a restored backup bypasses it — so
 * "javascript:", "data:", "intent:" and protocol-relative "//evil.com" are all
 * refused here, at the last point before the address is handed to Android.
 *
 * A prefix test rather than `new URL()`: Hermes has no spec-complete URL parser,
 * and the scheme is the whole question. The character after the slashes has to
 * be part of a host, so a bare "https://" cannot render as a dead row either.
 *
 * Everything is read as `unknown` on purpose. The declared type says these two
 * are always strings; a server from before this shipped, or one behind a proxy
 * that rewrites bodies, has never promised anything of the sort, and a `.trim()`
 * on a number here would throw inside render and take the screen with it.
 */
function formLinkOf(
  settings: { employeeFormUrl: string; employeeFormLabel: string } | null,
): FormLink | null {
  const rawUrl: unknown = settings?.employeeFormUrl;
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!/^https?:\/\/[^/\s]/i.test(url)) return null;
  const rawLabel: unknown = settings?.employeeFormLabel;
  const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, MAX_FORM_LABEL_LENGTH) : "";
  return { url, label: label || DEFAULT_FORM_LABEL };
}

/** Said when the phone will not take the link — the address itself is the fallback. */
function cantOpenMessage(url: string): string {
  return `Couldn't open the form on this phone. Open this link in your browser instead: ${url}`;
}

/** Optional fields come back as "" rather than null on this endpoint. */
function dash(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v ? v : "—";
}

/** Half a shift is not a shift: an empty end time used to render as "09:00 – ". */
function shiftLabel(p: Profile): string {
  if (!p.workStartTime || !p.workEndTime) return "—";
  return `${p.workStartTime} – ${p.workEndTime}`;
}

/** Short month names for reading a date back. No Intl — Hermes ships without the full ICU data. */
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

const digitsOnly = (t: string): string => t.replace(/\D/g, "");

const pad2 = (t: string): string => (t.length === 1 ? `0${t}` : t);

/** Last day of a 1-based month, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** The stored "YYYY-MM-DD" split into the three boxes; "" leaves them empty. */
function splitDob(raw: string): { day: string; month: string; year: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return { day: "", month: "", year: "" };
  return { year: m[1], month: m[2], day: m[3] };
}

/**
 * The server answers a bad date with a flat 400 ("Date of birth must be
 * YYYY-MM-DD."), which says nothing about 31 February — so the real calendar
 * check happens here, where the wording can name the month that is short.
 */
function dobProblem(day: string, month: string, year: string): string | null {
  if (!day || !month || !year) return "Enter your date of birth as day, month and year.";
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const thisYear = new Date().getFullYear();
  if (year.length !== 4 || y < 1900 || y > thisYear) {
    return `Enter the birth year as 4 digits between 1900 and ${thisYear}.`;
  }
  if (m < 1 || m > 12) return "The birth month must be between 1 and 12.";
  const last = daysInMonth(y, m);
  if (d < 1 || d > last) {
    return `${MONTHS[m - 1]} ${y} has only ${last} days — check the day.`;
  }
  return null;
}

/** "14 May 1990" — what the three boxes actually add up to. */
function prettyDob(day: string, month: string, year: string): string {
  return `${parseInt(day, 10)} ${MONTHS[parseInt(month, 10) - 1]} ${year}`;
}

/**
 * The stored date read back the same way, or "Not set".
 *
 * Not formatDate(): that is built for attendance days, so it prints the weekday
 * and drops the year — on a date of birth the year is the whole point, and it is
 * the part an employee cannot re-check without spending one of two edits. A
 * month outside 1-12 would index past MONTHS, so the row is matched against a
 * real day before it is read back.
 */
function dobLabel(raw: string): string {
  const { day, month, year } = splitDob(raw);
  if (!year || !MONTHS[parseInt(month, 10) - 1]) return "Not set";
  return prettyDob(day, month, year);
}

/**
 * Self-edits still available. The server computes this, but a value it never
 * sent — an app pointed at a build from before this shipped — must not read as
 * "one left", so anything unusable clamps to none and the edit stays shut.
 */
function editsLeft(p: Profile): number {
  const n = Number(p.editsRemaining);
  return Number.isFinite(n) ? Math.min(MAX_EDITS, Math.max(0, n)) : 0;
}

/** "You can change this 2 more times." */
function allowanceLine(remaining: number): string {
  return remaining === 1
    ? "You can change this 1 more time."
    : `You can change this ${remaining} more times.`;
}

/**
 * The employee's own record.
 *
 * Almost read-only by design — everything here is set by an admin, so the screen
 * is a header card saying who you are, the facts underneath, and the two things
 * an employee owns: their date of birth, and ending the session. `role` on the
 * profile is the job title the office uses; `session.role` is what the server
 * lets this account do, and the two genuinely differ (a "Senior Teacher" holding
 * an admin login), so the access level keeps its own row rather than folding
 * into "Job role".
 *
 * The birthday is the one exception to read-only, and a rationed one: the server
 * allows two self-edits and then points at Head Office. That count is the
 * server's to keep — this screen only reflects it, and reloads after every save
 * so a second device spending the last edit shows up here.
 */
export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Head Office's form link, or null while no admin has set one. */
  const [formLink, setFormLink] = useState<FormLink | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  /** The date-of-birth sheet: its own busy flag, its own error, its own boxes. */
  const [dobOpen, setDobOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dobDay, setDobDay] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobYear, setDobYear] = useState("");

  /**
   * Focus and pull-to-refresh can both have a fetch in flight at once. Only the
   * newest one is allowed to write state, otherwise a slow failed request can
   * land after a fast successful one and paint an error over fresh data.
   */
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;

    // The form link is fetched alongside the profile but never awaited with it.
    // It is an optional extra on someone's own record, so it decides nothing:
    // a slow /api/app-settings — or one that never answers, which fetch has no
    // timeout for — must not hold the screen on a spinner, and a failure must
    // not paint an error over the profile. Every path that is not a usable link
    // ends at null, and null renders nothing at all.
    void api
      .appSettings()
      // An empty 200 body parses to null, so the response is read through `?.`
      // rather than trusting the declared shape. The catch sits after the
      // mapping, not beside it: as a second argument to the same .then() it
      // would only see the request failing, and a TypeError raised in the
      // mapping itself would escape to break the screen.
      .then((r) => formLinkOf(r?.settings ?? null))
      .catch(() => null)
      .then((link) => {
        if (id !== reqId.current) return;
        setFormLink(link);
        // Cleared with the link it belongs to: once an admin edits the URL, a
        // "couldn't open" line left over from the old one names an address the
        // screen no longer shows.
        setLinkError(null);
      });

    try {
      setError(null);
      const res = await api.profile();
      if (id !== reqId.current) return;
      setProfile(res.profile);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load your profile.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Pull-to-refresh drives its own flag. Wired to `loading` the spinner never
   * appeared, since `load` only ever lowers that flag after the first fetch.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  /**
   * Hand the link to whatever this phone uses for the web.
   *
   * No canOpenURL() gate in front of it. From Android 11 that call answers
   * through the package-visibility filter — it resolves the intent against the
   * <queries> block, which only declares the https scheme — so a plain http://
   * address, which the server accepts, would report as unopenable on all 71
   * phones with a browser sitting right there. openURL() starts the activity
   * instead of resolving it and is not filtered that way. Nothing is lost by
   * dropping the check: the scheme was already settled by formLinkOf, and a
   * device genuinely unable to take the address rejects here just the same.
   *
   * Wrapped because that rejection is a real one, and an unhandled rejection on
   * the profile screen would cost an employee the rest of the screen over an
   * optional extra.
   */
  const openFormLink = useCallback(async () => {
    if (!formLink) return;
    setLinkError(null);
    try {
      await Linking.openURL(formLink.url);
    } catch {
      setLinkError(cantOpenMessage(formLink.url));
    }
  }, [formLink]);

  const storedDob = (profile?.dateOfBirth ?? "").trim();
  const remaining = profile ? editsLeft(profile) : 0;

  /** Reads the three boxes back in words, so a typo shows before saving. */
  const dobHint = useMemo(() => {
    if (!dobDay && !dobMonth && !dobYear) return "Day, month and year — like 14 / 05 / 1990.";
    if (dobProblem(dobDay, dobMonth, dobYear)) {
      return "Not a real date yet — day, month and year, like 14 / 05 / 1990.";
    }
    return prettyDob(dobDay, dobMonth, dobYear);
  }, [dobDay, dobMonth, dobYear]);

  /**
   * Prefilled from the stored date every time, so a half-typed one abandoned
   * yesterday never reappears. Nothing opens once the allowance is gone: the
   * screen shows the server's own message instead of a form it would refuse.
   */
  function openDob() {
    if (!profile || remaining <= 0) return;
    const parts = splitDob(storedDob);
    setDobDay(parts.day);
    setDobMonth(parts.month);
    setDobYear(parts.year);
    setFormError(null);
    setDobOpen(true);
  }

  /** Never mid-save: the PATCH is already in flight and the sheet holds its error. */
  function closeDob() {
    if (saving) return;
    setDobOpen(false);
    setFormError(null);
  }

  async function saveDob() {
    setFormError(null);
    const problem = dobProblem(dobDay, dobMonth, dobYear);
    if (problem) {
      setFormError(problem);
      return;
    }

    let close = false;
    let reload = false;
    setSaving(true);
    try {
      // Re-saving the date already stored is deliberately not special-cased
      // here: the server answers { unchanged: true } and spends no edit on it.
      await api.updateMyProfile(`${dobYear}-${pad2(dobMonth)}-${pad2(dobDay)}`);
      close = true;
      reload = true;
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't save your date of birth.";
      if (e instanceof ApiError && e.status === 403) {
        // The allowance ran out somewhere else — a second device, or an admin
        // mid-edit. The sheet has nothing left to offer, so it closes and the
        // server's own wording goes to the top of the screen.
        setError(message);
        close = true;
        reload = true;
      } else {
        // Stays open on anything else, with the typed date intact to retry.
        setFormError(message);
      }
    } finally {
      setSaving(false);
    }

    // Both of these run after the flag drops, never across it: `saving` also
    // gates closeDob, so holding it over a fetch that never settles would trap
    // the sheet open for good.
    if (close) setDobOpen(false);
    if (reload) void load();
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Profile" right={<NotificationBell />} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        {loading && !profile ? <Loading /> : null}

        {profile ? (
          <>
            <View style={styles.identity}>
              <Avatar name={profile.name} size={56} />
              <View style={styles.identityText}>
                <Text style={styles.identityName} numberOfLines={1}>
                  {profile.name}
                </Text>
                <Text style={styles.identityId} numberOfLines={1}>
                  {profile.id}
                </Text>
              </View>
            </View>

            <SectionHeader title="Details" />
            <View style={styles.card}>
              <DetailRow label="Job role" value={dash(profile.jobRole)} />
              <DetailRow label="Office" value={dash(profile.office)} />
              <DetailRow label="Shift" value={shiftLabel(profile)} />
              <DetailRow label="Mobile" value={dash(profile.mobileNumber)} />
              <DetailRow label="Email" value={dash(profile.email)} />
              <DetailRow label="Date of birth" value={dobLabel(storedDob)} />
              <DetailRow label="Access level" value={dash(session?.role)} />

              {/* The one editable fact, kept under the rows it belongs to rather
                  than in a card of its own — and never offered as a form when
                  the server would only refuse it. */}
              <View style={styles.editBlock}>
                {remaining > 0 ? (
                  <>
                    <Muted>{allowanceLine(remaining)}</Muted>
                    <Button
                      label={storedDob ? "Change date of birth" : "Add date of birth"}
                      variant="secondary"
                      onPress={openDob}
                    />
                  </>
                ) : (
                  <Notice tone="warn">{SPENT_MESSAGE}</Notice>
                )}
              </View>
            </View>
          </>
        ) : null}

        {!loading && !profile && !error ? (
          <EmptyState
            icon="person-outline"
            title="Profile unavailable"
            body="Pull down to load your details again."
          />
        ) : null}

        {/* One link for the whole office, set by an admin. Nothing at all is
            rendered until there is one: an empty row or a dead button would
            only raise questions on 71 phones. */}
        {formLink ? (
          <View style={styles.section}>
            <SectionHeader title="Forms" />
            <Row
              left={<Ionicons name="document-text-outline" size={22} color={colors.brand} />}
              title={formLink.label}
              subtitle="Opens in your browser"
              titleLines={2}
              onPress={openFormLink}
            />
            {linkError ? <Notice>{linkError}</Notice> : null}
          </View>
        ) : null}

        <SectionHeader title="Session" />
        <View style={styles.card}>
          <Muted>
            You are signed in on this device only. Signing in on another device — or in a
            browser — will end this session.
          </Muted>
          <Button
            label="Sign out"
            variant="danger"
            busy={signingOut}
            onPress={async () => {
              setSigningOut(true);
              try {
                // `busy` also disables the button, so a rejected signOut (a
                // SecureStore delete that throws) would leave the only way out
                // of the app spinning forever. Always give the button back.
                await signOut();
              } catch {
                setError("Couldn't sign out. Try again.");
              } finally {
                setSigningOut(false);
              }
            }}
          />
        </View>

        <Text style={styles.server}>
          {IS_PRODUCTION_TARGET ? "Server" : "Dev server"} · {API_BASE_URL}
        </Text>
      </ScrollView>

      {/* Body rendered only while open, so a closed sheet costs nothing.
          openDob is what fills the boxes — they live up in the screen. */}
      <Sheet visible={dobOpen} title="Date of birth" onClose={closeDob}>
        {dobOpen ? (
          <>
            {formError ? <Notice>{formError}</Notice> : null}

            <View style={styles.card}>
              {/* No date-picker module is installed. Three boxes rather than one
                  free-text field: each one fits a number pad, and nothing can
                  arrive as 14/05/1990 when the server only takes 1990-05-14. */}
              <View style={styles.dobRow}>
                <View style={styles.dobCell}>
                  <FormField
                    label="Day"
                    value={dobDay}
                    onChangeText={(t) => setDobDay(digitsOnly(t).slice(0, 2))}
                    placeholder="DD"
                    keyboardType="number-pad"
                    maxLength={2}
                    editable={!saving}
                  />
                </View>
                <View style={styles.dobCell}>
                  <FormField
                    label="Month"
                    value={dobMonth}
                    onChangeText={(t) => setDobMonth(digitsOnly(t).slice(0, 2))}
                    placeholder="MM"
                    keyboardType="number-pad"
                    maxLength={2}
                    editable={!saving}
                  />
                </View>
                <View style={styles.dobCell}>
                  <FormField
                    label="Year"
                    value={dobYear}
                    onChangeText={(t) => setDobYear(digitsOnly(t).slice(0, 4))}
                    placeholder="YYYY"
                    keyboardType="number-pad"
                    maxLength={4}
                    editable={!saving}
                  />
                </View>
              </View>
              <Text style={styles.dobHint}>{dobHint}</Text>
            </View>

            <Muted>
              {allowanceLine(remaining)} After that only Head Office can change it.
            </Muted>

            <Button label="Save date of birth" onPress={saveDob} busy={saving} />
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

  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  identityText: { flex: 1, gap: 2 },
  identityName: { ...type.title, color: colors.ink },
  identityId: { ...type.small, color: colors.inkSoft },

  section: { gap: spacing.sm },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },

  // A rule above it, so the action reads as belonging to the rows rather than
  // floating loose at the bottom of the card.
  editBlock: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    paddingTop: spacing.md,
  },
  dobRow: { flexDirection: "row", gap: spacing.md },
  dobCell: { flex: 1 },
  dobHint: { ...type.small, color: colors.muted, fontSize: 12 },

  server: {
    ...type.small,
    color: colors.muted,
    fontSize: 11,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
