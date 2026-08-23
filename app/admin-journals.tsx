import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError } from "../src/api/client";
import { adminExtra, Journal } from "../src/api/admin";
import { Muted, Notice } from "../src/components/ui";
import {
  Avatar,
  EmptyState,
  IconButton,
  Loading,
  ScreenHeader,
  SearchBar,
  StatStrip,
  StatusPill,
} from "../src/components/adminui";
import { colors, radius, spacing, type } from "../src/theme";
import { formatDate, formatTime } from "../src/lib/punch";

/** The endpoint returns at most this many rows and has no pagination. */
const PAGE_CAP = 100;

/** Local YYYY-MM-DD — journals are keyed on the office's calendar day, not UTC's. */
function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

function prettyDay(iso: string): string {
  const today = isoDay(new Date());
  if (iso === today) return "Today";
  if (iso === shiftDay(today, -1)) return "Yesterday";
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * First non-blank line of an entry, for the collapsed card.
 *
 * Entries are free text and people often open with a blank line or a heading
 * gap, so taking split("\n")[0] blindly shows an empty preview often enough to
 * look broken.
 */
function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Daily journals for the whole office.
 *
 * The web renders these as a table of expanding rows. On a phone that becomes a
 * card list instead: collapsed to one line each so a day of sixty entries can be
 * skimmed, with only one card open at a time so the screen never turns into an
 * unscrollable wall of prose.
 *
 * Journal text is whitespace-significant — the web prints it pre-wrap — so the
 * expanded body renders the raw string rather than re-joining or trimming it.
 */
export default function AdminJournalsScreen() {
  const router = useRouter();
  const [date, setDate] = useState(() => isoDay(new Date()));
  const [journals, setJournals] = useState<Journal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // Tapping the day arrows quickly leaves several requests in flight, and they
  // do not necessarily come back in the order they were sent. Only the newest
  // one may write state — otherwise a slow fetch for an older day lands last and
  // fills the list with entries the header says belong to a different date.
  const reqId = useRef(0);

  const load = useCallback(async (day: string) => {
    const id = ++reqId.current;
    setError(null);
    try {
      const res = await adminExtra.journals(day);
      if (id !== reqId.current) return;
      setJournals(Array.isArray(res.journals) ? res.journals : []);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load the journals for this day.");
    } finally {
      if (id === reqId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [load, date]),
  );

  const today = isoDay(new Date());
  const atToday = date >= today;

  function go(days: number) {
    const next = shiftDay(date, days);
    if (next > today) return; // nobody has written tomorrow's journal yet
    setLoading(true);
    setJournals(null);
    setOpenId(null);
    setDate(next);
  }

  function refresh() {
    setRefreshing(true);
    load(date);
  }

  function goBack() {
    // Also reachable as a deep link, where there is no stack entry to pop.
    if (router.canGoBack()) router.back();
    else router.replace("/(admin)");
  }

  const totals = useMemo(() => {
    const list = journals ?? [];
    return {
      entries: list.length,
      todos: list.reduce((sum, j) => sum + (Array.isArray(j.todos) ? j.todos.length : 0), 0),
    };
  }, [journals]);

  const visible = useMemo(() => {
    const list = journals ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (j) => j.employeeName.toLowerCase().includes(q) || j.employeeId.toLowerCase().includes(q),
    );
  }, [journals, query]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="Journals"
        subtitle={formatDate(date)}
        onBack={goBack}
      />

      <View style={styles.controls}>
        <View style={styles.dateBar}>
          <IconButton name="chevron-back" onPress={() => go(-1)} accessibilityLabel="Previous day" />
          <Text style={styles.dateText}>{prettyDay(date)}</Text>
          <IconButton
            name="chevron-forward"
            onPress={() => go(1)}
            disabled={atToday}
            accessibilityLabel="Next day"
          />
        </View>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search name or ID" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        {journals && journals.length >= PAGE_CAP ? (
          <Notice tone="warn">
            {`Only the first ${PAGE_CAP} journals for this day are shown. Search to narrow the list.`}
          </Notice>
        ) : null}

        {journals ? (
          <StatStrip
            stats={[
              { label: "Entries", value: totals.entries },
              { label: "To-dos", value: totals.todos, tone: totals.todos ? colors.brand : undefined },
            ]}
          />
        ) : null}

        {loading && !journals ? <Loading /> : null}

        {visible.map((j) => {
          const open = openId === j.id;
          const todos = Array.isArray(j.todos) ? j.todos : [];
          // Same stance as todos above: the response is untyped JSON, and an
          // entry saved with only a to-do list has no tasks string to split.
          const tasks = typeof j.tasks === "string" ? j.tasks : "";
          const preview = firstLine(tasks);
          return (
            <View key={j.id} style={styles.card}>
              <Pressable
                onPress={() => setOpenId(open ? null : j.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${j.employeeName}, ${open ? "hide" : "show"} journal`}
                style={({ pressed }) => [styles.cardHead, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Avatar name={j.employeeName} />
                <View style={styles.cardHeadText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {j.employeeName}
                  </Text>
                  <Text style={styles.preview} numberOfLines={open ? 1 : 2}>
                    {open ? j.employeeId : preview || "No tasks written"}
                  </Text>
                </View>
                {todos.length ? (
                  <StatusPill
                    label={`${todos.length} to-do`}
                    fg={colors.brand}
                    bg={colors.brandTint}
                  />
                ) : null}
                <Ionicons
                  name={open ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.muted}
                />
              </Pressable>

              {open ? (
                <View style={styles.cardBody}>
                  <Text style={styles.bodyLabel}>TASKS</Text>
                  {tasks.trim() ? (
                    // The raw string on purpose: its own line breaks are the only
                    // structure the entry has.
                    <Text style={styles.tasks}>{tasks}</Text>
                  ) : (
                    <Muted>Nothing written for this day.</Muted>
                  )}

                  {todos.length ? (
                    <>
                      <Text style={styles.bodyLabel}>TO-DO LIST</Text>
                      <View style={styles.todoList}>
                        {todos.map((todo, i) => (
                          <View key={`${j.id}-todo-${i}`} style={styles.todo}>
                            <Ionicons
                              name="ellipse-outline"
                              size={13}
                              color={colors.brand}
                              style={styles.todoDot}
                            />
                            <Text style={styles.todoText}>{todo}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  ) : null}

                  <Muted>{`Updated ${formatTime(j.updatedAt)}`}</Muted>
                </View>
              ) : null}
            </View>
          );
        })}

        {!loading && journals && !visible.length ? (
          query.trim() ? (
            <EmptyState
              icon="search-outline"
              title="No one matches"
              body="Try a different name or employee ID."
            />
          ) : (
            <EmptyState
              icon="book-outline"
              title="No journals for this day"
              body="Employees write these from their own app."
            />
          )
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  controls: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  dateText: { ...type.heading, color: colors.ink },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },

  card: { backgroundColor: colors.card, borderRadius: radius.md, overflow: "hidden" },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardHeadText: { flex: 1, gap: 2 },
  name: { ...type.heading, color: colors.ink },
  preview: { ...type.small, color: colors.inkSoft, lineHeight: 18 },

  cardBody: {
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  bodyLabel: { ...type.label, color: colors.muted },
  tasks: { ...type.body, color: colors.ink, lineHeight: 22 },
  todoList: { gap: spacing.sm },
  todo: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  todoDot: { marginTop: 4 },
  todoText: { ...type.body, color: colors.inkSoft, flex: 1, lineHeight: 21 },
});
