import { useEffect, useRef, useState } from "react";
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
import { colors, spacing, type } from "../src/theme";
import { s } from "../src/lib/responsive";

/**
 * Daily journal: one row per employee per day. POST upserts, so saving twice
 * on the same date edits rather than duplicating.
 */
export default function JournalScreen() {
  const router = useRouter();
  const date = new Date().toISOString().slice(0, 10);
  const todoInputRef = useRef<TextInput>(null);

  const [tasks, setTasks] = useState("");
  const [todos, setTodos] = useState<string[]>([]);
  const [draftTodo, setDraftTodo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.journal(date);
        if (res.journal) {
          setTasks(res.journal.tasks);
          setTodos(Array.isArray(res.journal.todos) ? res.journal.todos : []);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't load today's journal.");
      } finally {
        setLoading(false);
      }
    })();
  }, [date]);

  async function save() {
    setError(null);
    if (todos.length === 0) {
      setError("Add at least one task under 'Work done today' before saving.");
      return;
    }
    setSaving(true);
    try {
      await api.saveJournal({ date, tasks: tasks.trim(), todos });
      setSaved(true);
      setTimeout(() => router.back(), 500);
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
    // Keep the keyboard open so the user can add the next item immediately.
    todoInputRef.current?.focus();
  }

  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View>
            <Title>Daily Journal</Title>
            <Muted>{dateLabel}</Muted>
          </View>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={26} color={colors.inkSoft} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Work done today — list of tasks */}
          <Card>
            <Label>Work done today</Label>

            {todos.length === 0 ? (
              <View style={styles.emptyHint}><Muted>No tasks added yet. Add one below.</Muted></View>
            ) : (
              todos.map((t, i) => (
                <View key={`${t}-${i}`} style={styles.todoRow}>
                  <Ionicons name="checkmark-circle-outline" size={18} color={colors.brand} />
                  <Text style={styles.todoText}>{t}</Text>
                  <Pressable
                    onPress={() => setTodos((prev) => prev.filter((_, idx) => idx !== i))}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${t}`}
                  >
                    <Ionicons name="close-circle" size={18} color={colors.muted} />
                  </Pressable>
                </View>
              ))
            )}

            {/* Inline add row */}
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
                submitBehavior="submit"
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
          </Card>

          {/* Briefing — optional */}
          <Card>
            <Field
              label="Briefing / Additional notes (optional)"
              value={tasks}
              onChangeText={setTasks}
              placeholder="e.g. Pending items, handover notes, anything to flag…"
              multiline
              editable={!loading && !saving}
              style={styles.textarea}
            />
          </Card>

          {error ? <Notice>{error}</Notice> : null}
          {saved ? <Notice tone="ok">Journal saved.</Notice> : null}

          <Button
            label="Save journal"
            onPress={save}
            busy={saving}
            disabled={loading}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
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
