import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, ApiError } from "../src/api/client";
import { Button, Card, Field, Label, Muted, Notice, Title } from "../src/components/ui";
import { colors, radius, spacing, type } from "../src/theme";

/**
 * Daily journal: one row per employee per day. POST upserts, so saving twice
 * on the same date edits rather than duplicating.
 */
export default function JournalScreen() {
  const router = useRouter();
  const date = new Date().toISOString().slice(0, 10);

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
    if (!tasks.trim()) {
      setError("Write what you worked on before saving.");
      return;
    }
    setSaving(true);
    try {
      await api.saveJournal({ date, tasks: tasks.trim(), todos });
      setSaved(true);
      setTimeout(() => router.back(), 800);
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
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Title>Today's journal</Title>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close" accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.inkSoft} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Muted>{new Date(date + "T00:00:00").toDateString()}</Muted>

          <Card>
            <Field
              label="What did you work on?"
              value={tasks}
              onChangeText={setTasks}
              placeholder="Closed 3 enquiries, follow-up calls"
              multiline
              editable={!loading && !saving}
              style={styles.textarea}
            />
          </Card>

          <Card>
            <Label>To-dos for tomorrow</Label>
            {todos.map((t, i) => (
              <View key={`${t}-${i}`} style={styles.todoRow}>
                <Ionicons name="ellipse-outline" size={16} color={colors.brand} />
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
            ))}

            <View style={styles.addRow}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Add a to-do"
                  value={draftTodo}
                  onChangeText={setDraftTodo}
                  placeholder="Send quotation to Sharma Traders"
                  onSubmitEditing={addTodo}
                  returnKeyType="done"
                />
              </View>
            </View>
            <Button label="Add to list" variant="secondary" onPress={addTodo} />
          </Card>

          {error ? <Notice>{error}</Notice> : null}
          {saved ? <Notice tone="ok">Journal saved.</Notice> : null}

          <Button label="Save journal" onPress={save} busy={saving} disabled={loading} />
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
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  textarea: { minHeight: 110, textAlignVertical: "top" },
  todoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  todoText: { ...type.body, color: colors.ink, flex: 1 },
  addRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-end" },
});
