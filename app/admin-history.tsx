import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ApiError } from "../src/api/client";
import { Activity, adminExtra } from "../src/api/admin";
import { Notice } from "../src/components/ui";
import {
  Chip,
  DetailRow,
  EmptyState,
  FilterChips,
  IconButton,
  Loading,
  Row,
  ScreenHeader,
  SearchBar,
  SectionHeader,
  Sheet,
  StatStrip,
} from "../src/components/adminui";
import { colors, radius, spacing, type } from "../src/theme";
import { formatDate, formatTime } from "../src/lib/punch";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 350;
/** Start fetching the next page this many pixels before the true bottom. */
const NEAR_END_PX = 320;

type IconName = React.ComponentProps<typeof Ionicons>["name"];
type Look = { label: string; icon: IconName; tone: string };

/**
 * Which family an action belongs to.
 *
 * The log is written by a dozen call sites on the server and new action types
 * appear without a client release, so this matches on substrings rather than
 * enumerating a list the app cannot verify. "login"/"otp" is tested first on
 * purpose: `employee_login` contains both "employee" and "login", and it is an
 * auth event, not a staff edit.
 */
function group(actionType: string): Look {
  const t = String(actionType ?? "").toLowerCase();
  if (t.includes("login") || t.includes("otp"))
    return { label: "Auth", icon: "key-outline", tone: colors.inkSoft };
  if (t.includes("leave")) return { label: "Leave", icon: "calendar-outline", tone: colors.brand };
  if (t.includes("punch") || t.includes("attendance") || t.includes("mark"))
    return { label: "Attendance", icon: "checkmark-circle-outline", tone: colors.ok };
  if (t.includes("employee") || t.includes("staff"))
    return { label: "Staff", icon: "person-outline", tone: colors.warn };
  return { label: "Other", icon: "ellipsis-horizontal-circle-outline", tone: colors.muted };
}

/** The family's look, sharpened by the verb so a rejection reads red at a glance. */
function look(actionType: string): Look {
  const base = group(actionType);
  const t = String(actionType ?? "").toLowerCase();
  if (t.includes("reject") || t.includes("absent"))
    return { ...base, icon: "close-circle-outline", tone: colors.danger };
  if (t.includes("approve")) return { ...base, icon: "checkmark-done-outline", tone: colors.ok };
  if (t.includes("undo")) return { ...base, icon: "arrow-undo-outline", tone: colors.warn };
  if (t.includes("request")) return { ...base, icon: "document-text-outline", tone: base.tone };
  return base;
}

/** The action's own colour at ~12%, so the tile reads as a wash and not a badge. */
function tintOf(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}1F` : colors.bg;
}

/** "leave_request" -> "Leave request" */
function prettyAction(actionType: string): string {
  const words = String(actionType ?? "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Activity";
}

/** "employeeId" -> "Employee id" */
function prettyKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Detail";
}

/**
 * Activity timestamps are SQLite's CURRENT_TIMESTAMP — UTC, written without a
 * zone. Parsing the clock digits as local would shift every row by 5.5 hours,
 * so the Z is appended the way punch.ts does, unless the string already carries
 * a zone of its own.
 */
function parseStamp(raw: string): Date | null {
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  const d = new Date(zoned ? iso : `${iso}Z`);
  return isNaN(d.getTime()) ? null : d;
}

/** Local YYYY-MM-DD, built from local parts so the day never slips a date. */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function relative(raw: string, now: number): string {
  const d = parseStamp(raw);
  if (!d) return raw;
  const diff = now - d.getTime();
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(localDay(d));
}

function absolute(raw: string): string {
  const d = parseStamp(raw);
  if (!d) return raw;
  // Hand formatTime a fully-zoned string so it localises rather than re-guessing.
  return `${formatDate(localDay(d))} · ${formatTime(d.toISOString())}`;
}

function text(...values: Array<string | null | undefined>): string {
  for (const v of values) if (v && v.trim()) return v;
  return "—";
}

function metaValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const json: string | undefined = JSON.stringify(value);
  return json ?? "—";
}

function metaEntries(meta: Record<string, unknown> | null): Array<[string, unknown]> {
  if (!meta || typeof meta !== "object") return [];
  return Object.entries(meta);
}

/**
 * A count the endpoint may not send. NaN would be worse than a wrong number
 * here: every `page >= pages` comparison against NaN is false, so a missing
 * `pages` would leave the infinite scroll asking for a next page forever.
 */
function count(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Pages can shift under an append; dedupe so a repeated row cannot collide keys. */
function merge(prev: Activity[], next: Activity[]): Activity[] {
  const seen = new Set(prev.map((a) => a.id));
  return [...prev, ...next.filter((a) => !seen.has(a.id))];
}

function union(prev: string[], rows: Activity[]): string[] {
  const set = new Set(prev);
  for (const r of rows) if (r.actionType) set.add(r.actionType);
  return set.size === prev.length ? prev : [...set];
}

function ActionTile({ actionType }: { actionType: string }) {
  const l = look(actionType);
  return (
    <View style={[styles.tile, { backgroundColor: tintOf(l.tone) }]}>
      <Ionicons name={l.icon} size={18} color={l.tone} />
    </View>
  );
}

/**
 * The audit trail.
 *
 * The web renders this as a table behind a numeric pager, which on a phone means
 * tapping "next" every thirty rows. Here it is one infinite list: page 1 loads
 * with the screen and the next page appends as the scroll nears the bottom, so
 * reading back through a week is a thumb-flick rather than a page hunt. Rows stay
 * quiet — icon, the server's own sentence, who did it, how long ago — and the
 * metadata the web fetches and discards lives in the sheet behind a tap.
 */
export default function AdminHistoryScreen() {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [actionType, setActionType] = useState("");

  const [items, setItems] = useState<Activity[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [appending, setAppending] = useState(false);
  // Separate from `loading`: bound to `loading`, the pull-to-refresh spinner
  // would be stuck open on first mount, next to the one the list already shows.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Activity | null>(null);

  // Only the newest request may write state, and only one fetch runs at a time —
  // scroll events fire far faster than a page round-trips.
  const reqRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const fetchPage = useCallback(
    async (target: number, append: boolean) => {
      const id = ++reqRef.current;
      busyRef.current = true;
      if (append) setAppending(true);
      else setLoading(true);
      try {
        const res = await adminExtra.activityLog({
          page: target,
          limit: PAGE_SIZE,
          actionType: actionType || undefined,
          search: search || undefined,
        });
        if (id !== reqRef.current) return;
        // A body that arrives without its array or its counts must not take the
        // list down, and must not disable the end-of-list guard either: an
        // absent `pages` falls back to the page that just landed, which reads
        // as "this was the last one".
        const rows: Activity[] = Array.isArray(res.activities) ? res.activities : [];
        const landed = count(res.page, 0);
        const at = landed > 0 ? landed : target;
        setError(null);
        setTotal((prev) => count(res.total, append ? prev : rows.length));
        setPages(Math.max(1, count(res.pages, at)));
        setPage(at);
        setItems((prev) => (append ? merge(prev, rows) : rows));
        // Chips are frozen while a filter is on: a filtered page only carries its
        // own action types, and rebuilding from it would drop every other chip.
        if (!actionType) setKnown((prev) => union(prev, rows));
      } catch (e) {
        if (id !== reqRef.current) return;
        setError(e instanceof ApiError ? e.message : "Couldn't load the activity log.");
        if (!append) setItems([]);
      } finally {
        if (id === reqRef.current) {
          busyRef.current = false;
          setAppending(false);
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [actionType, search],
  );

  // A filter or search change rebuilds fetchPage, which reloads from page 1.
  useEffect(() => {
    fetchPage(1, false);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (busyRef.current || page >= pages) return;
    fetchPage(page + 1, true);
  }, [fetchPage, page, pages]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchPage(1, false);
  }, [fetchPage]);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    // A page that just failed sits one scroll frame away from the bottom, so
    // without this the automatic path would re-fire the same failing request
    // on every flick. The "Load more" row below is still there to retry by hand.
    if (error) return;
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (contentSize.height - layoutMeasurement.height - contentOffset.y < NEAR_END_PX) loadMore();
  }

  /**
   * One chip per family actually present in the log. The key is the raw action
   * types joined by commas — the endpoint splits on commas and matches them
   * verbatim — so nothing here invents a filter value the server does not know.
   */
  const chips: Chip[] = useMemo(() => {
    const buckets = new Map<string, string[]>();
    for (const t of known) {
      const label = group(t).label;
      const list = buckets.get(label);
      if (list) list.push(t);
      else buckets.set(label, [t]);
    }
    const rest = [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, types]) => ({ key: [...types].sort().join(","), label }));
    return [{ key: "", label: "All" }, ...rest];
  }, [known]);

  const actors = useMemo(() => new Set(items.map((a) => a.performedBy)).size, [items]);
  const filtered = !!actionType || !!search;
  const now = Date.now();
  const meta = selected ? metaEntries(selected.metadata) : [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <ScreenHeader
            onBack={() => (router.canGoBack() ? router.back() : router.replace("/(admin)"))}
            title="Activity"
            subtitle={
              loading && !items.length ? "Loading…" : `${total} ${total === 1 ? "event" : "events"}`
            }
          />
        </View>
      </View>

      <View style={styles.controls}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search person or description"
        />
        <FilterChips chips={chips} active={actionType} onChange={setActionType} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        {items.length ? (
          <StatStrip
            stats={[
              { label: "Events", value: total },
              { label: "Loaded", value: items.length },
              { label: "People", value: actors },
            ]}
          />
        ) : null}

        {loading && !items.length ? <Loading /> : null}

        {items.length ? <SectionHeader title="Newest first" /> : null}

        {items.map((a) => (
          <Row
            key={a.id}
            left={<ActionTile actionType={a.actionType} />}
            title={a.description || prettyAction(a.actionType)}
            subtitle={
              a.targetName
                ? `${text(a.performedByName, a.performedBy)} → ${a.targetName}`
                : text(a.performedByName, a.performedBy)
            }
            meta={relative(a.timestamp, now)}
            onPress={() => setSelected(a)}
          />
        ))}

        {appending ? (
          <View style={styles.footer}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : null}

        {!loading && !appending && items.length > 0 && page < pages ? (
          <Row
            left={
              <View style={[styles.tile, { backgroundColor: tintOf(colors.brand) }]}>
                <Ionicons name="arrow-down-outline" size={18} color={colors.brand} />
              </View>
            }
            title="Load more"
            subtitle={`${items.length} of ${total} shown`}
            onPress={loadMore}
          />
        ) : null}

        {!loading && !appending && items.length > 0 && page >= pages ? (
          <Text style={styles.end}>That is the whole log.</Text>
        ) : null}

        {!loading && !items.length && !error ? (
          <EmptyState
            icon="time-outline"
            title={filtered ? "Nothing matches" : "No activity yet"}
            body={
              filtered
                ? "Try a different search or filter."
                : "Logins, marks and requests will show up here."
            }
          />
        ) : null}
      </ScrollView>

      {/* One event in full: the sentence the row had to truncate, then the audit
          fields — including the metadata the web fetches and throws away. */}
      <Sheet
        visible={!!selected}
        title={selected ? prettyAction(selected.actionType) : ""}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <>
            <View style={styles.sheetCard}>
              <Text style={styles.sheetText}>
                {selected.description || prettyAction(selected.actionType)}
              </Text>
            </View>

            <View style={styles.sheetCard}>
              <DetailRow label="When" value={absolute(selected.timestamp)} />
              <DetailRow label="Action type" value={text(selected.actionType)} />
              <DetailRow label="Category" value={group(selected.actionType).label} />
              <DetailRow
                label="Performed by"
                value={text(selected.performedByName, selected.performedBy)}
              />
              {selected.targetName || selected.targetId ? (
                <DetailRow label="Target" value={text(selected.targetName, selected.targetId)} />
              ) : null}
            </View>

            {meta.length ? (
              <>
                <SectionHeader title="Recorded details" />
                <View style={styles.sheetCard}>
                  {meta.map(([k, v]) => (
                    <DetailRow key={k} label={prettyKey(k)} value={metaValue(v)} />
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: "row", alignItems: "center" },
  back: { paddingLeft: spacing.lg },
  controls: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  tile: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  footer: { paddingVertical: spacing.lg, alignItems: "center" },
  end: { ...type.small, color: colors.muted, textAlign: "center", paddingVertical: spacing.lg },
  sheetCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetText: { ...type.body, color: colors.ink, lineHeight: 21 },
});
