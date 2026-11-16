import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, ApiError } from "../src/api/client";
import { Button, Card, Field, Label, Muted, Notice, Title } from "../src/components/ui";
import { colors, radius, spacing, type } from "../src/theme";
import { s } from "../src/lib/responsive";

/** Local "YYYY-MM-DD". Never toISOString(): that is UTC, which in India is the
 *  previous day before 5:30 AM, and turns local midnight into yesterday. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Always fresh — never stale across midnight. */
function getToday(): string {
  return ymd(new Date());
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + days));
}

function prettyDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Daily journal: one row per employee per day. POST upserts, so saving twice
 * on the same date edits rather than duplicating.
 */
export default function JournalScreen() {
  const router = useRouter();
  const todoInputRef = useRef<TextInput>(null);

  const [date, setDate] = useState(getToday);
  const isToday = date === getToday();

  const [tasks, setTasks] = useState("");
  const [todos, setTodos] = useState<string[]>([]);
  const [draftTodo, setDraftTodo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // What the server has for this day, to tell whether there are unsaved edits
  const [baseline, setBaseline] = useState({ tasks: "", todos: [] as string[] });
  // Only the latest load may write state, so a slow response for a day the
  // user already left can't fill in the day now on screen.
  const reqId = useRef(0);

  const dirty =
    isToday &&
    !loading &&
    (draftTodo.trim() !== "" ||
      tasks.trim() !== baseline.tasks.trim() ||
      todos.length !== baseline.todos.length ||
      todos.some((t, i) => t !== baseline.todos[i]));

  const loadJournal = useCallback(async (d: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    setSaved(false);
    setTasks("");
    setTodos([]);
    setDraftTodo("");
    setBaseline({ tasks: "", todos: [] });
    try {
      const res = await api.journal(d);
      if (id !== reqId.current) return;
      if (res.journal) {
        const t = res.journal.tasks === "-" ? "" : res.journal.tasks;
        const list = Array.isArray(res.journal.todos) ? res.journal.todos : [];
        setTasks(t);
        setTodos(list);
        setBaseline({ tasks: t, todos: list });
      }
    } catch (e) {
      if (id === reqId.current) setError(e instanceof ApiError ? e.message : "Couldn't load journal.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJournal(date);
  }, [date, loadJournal]);

  async function save() {
    setError(null);
    setSaved(false);
    // A task typed but not added with + still counts
    const draft = draftTodo.trim();
    const list = draft ? [...todos, draft] : todos;
    if (list.length === 0) {
      setError("Add at least one task under 'Work done today' before saving.");
      return;
    }
    setSaving(true);
    try {
      // Server requires `tasks` to be non-empty. If the user left briefing
      // blank, send a dash so the real content (todos list) still saves.
      const tasksValue = tasks.trim() || "-";
      await api.saveJournal({ date, tasks: tasksValue, todos: list });
      setTodos(list);
      setDraftTodo("");
      setBaseline({ tasks: tasks.trim(), todos: list });
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your journal.");
    } finally {
      setSaving(false);
    }
  }

  function addTodo() {
    const t = draftTodo.trim();
    if (!t) return;
    setTodos((prev) => [...prev, t]);
    setDraftTodo("");
    setSaved(false);
    todoInputRef.current?.focus();
  }

  /** Run `action`, but ask first if it would throw away unsaved edits. */
  function confirmLeave(action: () => void) {
    if (!dirty) return action();
    Alert.alert("Discard changes?", "Your journal for today has unsaved changes.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: action },
    ]);
  }

  // Android back button / gesture
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!dirty) return false;
      confirmLeave(() => router.back());
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  function goToDate(d: string) {
    confirmLeave(() => setDate(d));
  }

  function prevDay() {
    goToDate(shiftDate(date, -1));
  }

  function nextDay() {
    const next = shiftDate(date, 1);
    if (next <= getToday()) goToDate(next);
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Android is edge-to-edge, so the window no longer resizes for the
          keyboard on its own; pad on both platforms to keep inputs visible. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.header}>
          <Pressable
            onPress={() => confirmLeave(() => router.back())}
            hitSlop={14}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={24} color={colors.ink} />
          </Pressable>
          <Title>Daily Journal</Title>
          <View style={{ width: 40 }} />
        </View>

        {/* Date navigation */}
        <View style={styles.dateBar}>
          <Pressable onPress={prevDay} hitSlop={10} accessibilityLabel="Previous day" style={styles.chevron}>
            <Ionicons name="chevron-back" size={22} color={colors.brand} />
          </Pressable>
          <Pressable
            onPress={() => !isToday && goToDate(getToday())}
            disabled={isToday}
            style={styles.dateLabelWrap}
            accessibilityLabel={isToday ? "Today" : "Jump to today"}
          >
            <Text style={styles.dateText}>{prettyDate(date)}</Text>
            {isToday ? (
              <Text style={styles.todayBadge}>TODAY</Text>
            ) : (
              <Text style={styles.jumpTodayText}>Tap to return to today</Text>
            )}
          </Pressable>
          <Pressable
            onPress={nextDay}
            hitSlop={10}
            accessibilityLabel="Next day"
            disabled={date >= getToday()}
            style={styles.chevron}
          >
            <Ionicons
              name="chevron-forward"
              size={22}
              color={date >= getToday() ? colors.rule : colors.brand}
            />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Work done — list of tasks */}
          <Card>
            <Label>Work done {isToday ? "today" : "on this day"}</Label>

            {loading ? (
              <View style={styles.emptyHint}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : todos.length === 0 ? (
              <View style={styles.emptyHint}>
                <Muted>{isToday ? "No tasks added yet. Add one below." : "No tasks were logged."}</Muted>
              </View>
            ) : (
              todos.map((t, i) => (
                <View key={`${t}-${i}`} style={styles.todoRow}>
                  <Ionicons name="checkmark-circle-outline" size={18} color={colors.brand} />
                  <Text style={styles.todoText}>{t}</Text>
                  {isToday ? (
                    <Pressable
                      onPress={() => {
                        setTodos((prev) => prev.filter((_, idx) => idx !== i));
                        setSaved(false);
                      }}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${t}`}
                    >
                      <Ionicons name="close-circle" size={18} color={colors.muted} />
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}

            {/* Inline add row — only for today */}
            {isToday ? (
              <View style={styles.addRow}>
                <TextInput
                  ref={todoInputRef}
                  style={styles.todoInput}
                  value={draftTodo}
                  onChangeText={setDraftTodo}
                  placeholder="Add a task…"
                  placeholderTextColor={colors.muted}
                  onSubmitEditing={addTodo}
                  returnKeyType="done"
                  editable={!loading && !saving}
                />
                <Pressable
                  onPress={addTodo}
                  disabled={!draftTodo.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Add task"
                  style={({ pressed }) => ({
                    opacity: !draftTodo.trim() ? 0.35 : pressed ? 0.65 : 1,
                  })}
                >
                  <Ionicons name="add-circle" size={s(34)} color={colors.brand} />
                </Pressable>
              </View>
            ) : null}
          </Card>

          {/* Briefing — optional, only editable for today */}
          <Card>
            <Field
              label="Briefing / Additional notes (optional)"
              value={tasks}
              onChangeText={(t) => {
                setTasks(t);
                setSaved(false);
              }}
              placeholder={isToday ? "e.g. Pending items, handover notes, anything to flag…" : "No notes were added."}
              multiline
              editable={isToday && !loading && !saving}
              style={styles.textarea}
            />
          </Card>

          {error ? <Notice>{error}</Notice> : null}
          {saved && !dirty ? <Notice tone="ok">Journal saved.</Notice> : null}
          {dirty ? <Muted>You have unsaved changes.</Muted> : null}

          {isToday ? (
            <Button
              label={baseline.todos.length ? "Update journal" : "Save journal"}
              onPress={save}
              busy={saving}
              disabled={loading}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  chevron: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  dateLabelWrap: { flex: 1, alignItems: "center", gap: s(2) },
  dateText: { ...type.body, color: colors.ink, fontWeight: "600", textAlign: "center" },
  todayBadge: { ...type.label, color: colors.accent, fontSize: s(10) },
  jumpTodayText: { ...type.label, color: colors.brand, fontSize: s(10) },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  textarea: { minHeight: s(110), textAlignVertical: "top" },
  emptyHint: { paddingVertical: spacing.sm },
  todoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  todoText: { ...type.body, color: colors.ink, flex: 1 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: s(12),
    paddingHorizontal: spacing.md,
    paddingVertical: s(4),
    backgroundColor: colors.bg,
  },
  todoInput: {
    flex: 1,
    ...type.body,
    color: colors.ink,
    paddingVertical: s(10),
  },
});
