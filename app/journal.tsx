import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
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

/** Always fresh — never stale across midnight. */
function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

  const loadJournal = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    setSaved(false);
    setTasks("");
    setTodos([]);
    setDraftTodo("");
    try {
      const res = await api.journal(d);
      if (res.journal) {
        setTasks(res.journal.tasks === "-" ? "" : res.journal.tasks);
        setTodos(Array.isArray(res.journal.todos) ? res.journal.todos : []);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load journal.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJournal(date);
  }, [date, loadJournal]);

  async function save() {
    setError(null);
    setSaved(false);
    if (todos.length === 0) {
      setError("Add at least one task under 'Work done today' before saving.");
      return;
    }
    setSaving(true);
    try {
      // Server requires `tasks` to be non-empty. If the user left briefing
      // blank, send a dash so the real content (todos list) still saves.
      const tasksValue = tasks.trim() || "-";
      await api.saveJournal({ date, tasks: tasksValue, todos });
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
    todoInputRef.current?.focus();
  }

  function prevDay() {
    setDate((d) => shiftDate(d, -1));
  }

  function nextDay() {
    setDate((d) => {
      const today = getToday();
      const next = shiftDate(d, 1);
      return next > today ? d : next;
    });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
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
            onPress={() => !isToday && setDate(getToday())}
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

            {todos.length === 0 ? (
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
                      onPress={() => setTodos((prev) => prev.filter((_, idx) => idx !== i))}
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
              onChangeText={setTasks}
              placeholder={isToday ? "e.g. Pending items, handover notes, anything to flag…" : "No notes were added."}
              multiline
              editable={isToday && !loading && !saving}
              style={styles.textarea}
            />
          </Card>

          {error ? <Notice>{error}</Notice> : null}
          {saved ? <Notice tone="ok">Journal saved.</Notice> : null}

          {isToday ? (
            <Button
              label="Save journal"
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
