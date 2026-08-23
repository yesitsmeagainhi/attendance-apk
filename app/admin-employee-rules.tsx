import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError } from "../src/api/client";
import { adminExtra, EmployeeRule } from "../src/api/admin";
import { Muted, Notice } from "../src/components/ui";
import {
  EmptyState,
  FormSwitch,
  IconButton,
  Loading,
  ScreenHeader,
  StatStrip,
  StatusPill,
} from "../src/components/adminui";
import { colors, radius, spacing, type } from "../src/theme";

/** Half a unit is the smallest step any of these rules is written in. */
const STEP = 0.5;

/** A run of taps on +/- should cost one request, not one per tap. */
const WRITE_DELAY_MS = 600;

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** The wire says these are strings, but a null slipping through must not crash. */
function safeString(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw : "";
}

/**
 * `Number("")` is 0, which would quietly turn a missing value into a real
 * zero — and then disable the minus button forever. Blank is not a number.
 */
function toNumber(raw: string): number {
  return raw.trim() ? Number(raw) : NaN;
}

/** "15.0" -> "15", "15.50" -> "15.5". Anything unparseable passes through. */
function prettyNumber(raw: string): string {
  const n = toNumber(raw);
  if (Number.isNaN(n)) return raw;
  return String(Math.round(n * 100) / 100);
}

function prettyValue(rule: EmployeeRule, raw: string): string {
  if (rule.valueType === "boolean") return raw === "true" ? "On" : "Off";
  return prettyNumber(raw);
}

/**
 * Per-employee attendance rules.
 *
 * The office sets one set of rules for everyone; this screen is the escape
 * hatch for the one person whose grace period, minimum hours or lunch break
 * differ. Every rule here already has an office-wide default and an override is
 * only ever a deviation from it, so the default stays visible next to the
 * control and getting back to it is one tap rather than a delete flow.
 *
 * Values go over the wire as strings, booleans included ("true"/"false"), and
 * the server owns `effectiveValue` — so every successful write is followed by a
 * reload instead of a local patch.
 */
export default function AdminEmployeeRulesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const employeeId = firstParam(params.id);
  const employeeName = firstParam(params.name) || "This employee";

  const [rules, setRules] = useState<EmployeeRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Tapped but not yet confirmed by a reload — keeps the control instant. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  /**
   * A burst of taps on +/- can land faster than React re-renders, so the
   * handler cannot read the next number off `draft` — it would read the value
   * from a render that is already one or two taps behind and lose them. The ref
   * is written synchronously on every tap and is what the arithmetic reads;
   * `draft` only exists to paint it.
   */
  const draftRef = useRef<Record<string, string>>({});

  const putDraft = useCallback((ruleId: string, value: string) => {
    draftRef.current = { ...draftRef.current, [ruleId]: value };
    setDraft(draftRef.current);
  }, []);

  /** Drop a local value. With `only`, a newer tap keeps its number. */
  const dropDraft = useCallback((ruleId: string, only?: string) => {
    const current = draftRef.current;
    if (!(ruleId in current)) return;
    if (only !== undefined && current[ruleId] !== only) return;
    const next = { ...current };
    delete next[ruleId];
    draftRef.current = next;
    setDraft(next);
  }, []);

  const queue = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; value: string }>(),
  );

  const load = useCallback(async () => {
    if (!employeeId) {
      setError("This screen needs an employee to open. Go back and pick one from the list.");
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const res = await adminExtra.employeeRules(employeeId);
      setRules(Array.isArray(res.rules) ? res.rules : []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this employee's rules.");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const commit = useCallback(
    async (ruleId: string, value: string) => {
      setBusy((b) => ({ ...b, [ruleId]: true }));
      setError(null);
      try {
        await adminExtra.setEmployeeRule(employeeId, ruleId, value);
        await load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't save that rule. Try again.");
      } finally {
        setBusy((b) => ({ ...b, [ruleId]: false }));
        // Drop the local value only if no newer tap has replaced it already,
        // otherwise the newer number flashes back to the stale server one.
        dropDraft(ruleId, value);
      }
    },
    [employeeId, load, dropDraft],
  );

  const schedule = useCallback(
    (ruleId: string, value: string) => {
      const queued = queue.current.get(ruleId);
      if (queued) clearTimeout(queued.timer);
      const timer = setTimeout(() => {
        queue.current.delete(ruleId);
        void commit(ruleId, value);
      }, WRITE_DELAY_MS);
      queue.current.set(ruleId, { timer, value });
    },
    [commit],
  );

  useEffect(() => {
    const pending = queue.current;
    return () => {
      // Leaving mid-debounce must not swallow the taps: fire them now and let
      // the reply land nowhere, rather than dropping the change on the floor.
      pending.forEach((item, ruleId) => {
        clearTimeout(item.timer);
        adminExtra.setEmployeeRule(employeeId, ruleId, item.value).catch(() => undefined);
      });
      pending.clear();
    };
  }, [employeeId]);

  function valueOf(rule: EmployeeRule): string {
    return draft[rule.ruleId] ?? safeString(rule.effectiveValue);
  }

  function step(rule: EmployeeRule, delta: number) {
    // Read the ref, not `draft`: a fast run of taps must each build on the last
    // one rather than on whatever the most recent render happened to hold.
    const shown = toNumber(draftRef.current[rule.ruleId] ?? safeString(rule.effectiveValue));
    const fallback = toNumber(safeString(rule.globalDefault));
    const from = Number.isNaN(shown) ? (Number.isNaN(fallback) ? 0 : fallback) : shown;
    // Snap to the step grid, so a value the web left at 4.3 lands on 4.5.
    const next = Math.max(0, Math.round((from + delta) / STEP) * STEP);
    const value = prettyNumber(String(next));
    putDraft(rule.ruleId, value);
    schedule(rule.ruleId, value);
  }

  function toggle(rule: EmployeeRule, on: boolean) {
    const value = on ? "true" : "false";
    putDraft(rule.ruleId, value);
    // One deliberate tap — nothing to batch, so write it straight away.
    void commit(rule.ruleId, value);
  }

  async function reset(rule: EmployeeRule) {
    const queued = queue.current.get(rule.ruleId);
    if (queued) {
      clearTimeout(queued.timer);
      queue.current.delete(rule.ruleId);
    }
    setBusy((b) => ({ ...b, [rule.ruleId]: true }));
    setError(null);
    try {
      await adminExtra.clearEmployeeRule(employeeId, rule.ruleId);
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Couldn't put that rule back to the office default.",
      );
    } finally {
      setBusy((b) => ({ ...b, [rule.ruleId]: false }));
      dropDraft(rule.ruleId);
    }
  }

  const overridden = useMemo(
    () => (rules ?? []).filter((r) => r.override != null).length,
    [rules],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title={employeeName}
        subtitle="Attendance rules"
        onBack={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        <Muted>
          {`These apply to ${employeeName} alone. Any rule left untouched keeps following the office-wide default.`}
        </Muted>

        {rules && rules.length ? (
          <StatStrip
            stats={[
              { label: "Rules", value: rules.length },
              {
                label: "Overridden",
                value: overridden,
                tone: overridden ? colors.brand : undefined,
              },
            ]}
          />
        ) : null}

        {loading && !rules ? <Loading /> : null}

        {rules?.map((rule) => (
          <RuleCard
            key={rule.ruleId}
            rule={rule}
            value={valueOf(rule)}
            busy={!!busy[rule.ruleId]}
            onStep={(delta) => step(rule, delta)}
            onToggle={(on) => toggle(rule, on)}
            onReset={() => reset(rule)}
          />
        ))}

        {!loading && rules && !rules.length ? (
          <EmptyState
            icon="options-outline"
            title="No rules to set"
            body="The office hasn't defined any attendance rules yet."
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One rule: label, what it does, the control, and — only when this employee
 * actually deviates — what the rest of the office is on and a way back to it.
 */
function RuleCard({
  rule,
  value,
  busy,
  onStep,
  onToggle,
  onReset,
}: {
  rule: EmployeeRule;
  value: string;
  busy: boolean;
  onStep: (delta: number) => void;
  onToggle: (on: boolean) => void;
  onReset: () => void;
}) {
  const isOverride = rule.override != null;
  const numeric = toNumber(value);
  const atZero = !Number.isNaN(numeric) && numeric <= 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{rule.label}</Text>
        {isOverride ? (
          <StatusPill label="Overridden" fg={colors.brand} bg={colors.brandTint} />
        ) : null}
      </View>

      {rule.description ? <Text style={styles.cardBody}>{rule.description}</Text> : null}

      {rule.valueType === "boolean" ? (
        <View style={styles.switchRow}>
          {/* The switch row carries its own padding; pulling it left by that
              much keeps its label on the card's text column. */}
          <View style={styles.switchFill}>
            <FormSwitch
              label={value === "true" ? "On for this employee" : "Off for this employee"}
              value={value === "true"}
              onChange={onToggle}
            />
          </View>
          <View style={styles.spinner}>
            {busy ? <ActivityIndicator size="small" color={colors.brand} /> : null}
          </View>
        </View>
      ) : (
        <View style={styles.stepper}>
          <IconButton
            name="remove"
            onPress={() => onStep(-STEP)}
            disabled={atZero}
            accessibilityLabel={`Decrease ${rule.label}`}
          />
          <View style={styles.valueWrap}>
            <Text style={styles.value}>{prettyNumber(value)}</Text>
            <View style={styles.spinner}>
              {busy ? <ActivityIndicator size="small" color={colors.brand} /> : null}
            </View>
          </View>
          <IconButton
            name="add"
            onPress={() => onStep(STEP)}
            accessibilityLabel={`Increase ${rule.label}`}
          />
        </View>
      )}

      {isOverride ? (
        <>
          <Muted>{`Office default: ${prettyValue(rule, safeString(rule.globalDefault))}`}</Muted>
          <Pressable
            onPress={onReset}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Reset ${rule.label} to the office default`}
            style={({ pressed }) => [styles.reset, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <Ionicons name="arrow-undo-outline" size={19} color={colors.brand} />
            )}
            <Text style={styles.resetText}>Reset to default</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  backBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, alignItems: "flex-start" },
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
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardTitle: { ...type.heading, color: colors.ink, flex: 1 },
  cardBody: { ...type.small, color: colors.inkSoft, lineHeight: 19 },

  switchRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs },
  switchFill: { flex: 1, marginLeft: -spacing.md },

  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  valueWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  value: { ...type.display, color: colors.ink, fontSize: 24 },
  /** Fixed slot, so the value doesn't shift when the spinner appears. */
  spinner: { width: 20, alignItems: "center", justifyContent: "center" },

  reset: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  resetText: { ...type.body, fontWeight: "600", color: colors.brand },
});
