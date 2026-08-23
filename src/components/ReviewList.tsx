import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiError } from "../api/client";
import { ReviewAction } from "../api/admin";
import { Card, Label, Muted, Notice } from "./ui";
import { colors, radius, spacing, type } from "../theme";

export type ReviewItem = {
  id: string;
  employeeName: string;
  title: string;
  detail: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  adminNote: string | null;
};

/**
 * Approve / reject list shared by the Requests and Leaves tabs.
 *
 * The note is optional but sent when filled, matching the web dashboard. The
 * server rejects a second review with 409, so a row that someone else has
 * already handled surfaces that message rather than silently doing nothing.
 */
export function ReviewList({
  items,
  onReview,
  emptyText,
}: {
  items: ReviewItem[];
  onReview: (id: string, action: ReviewAction, note: string) => Promise<void>;
  emptyText: string;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = useCallback(
    async (id: string, action: ReviewAction) => {
      setBusyId(id);
      setError(null);
      try {
        await onReview(id, action, notes[id]?.trim() ?? "");
        setNotes((n) => ({ ...n, [id]: "" }));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't save that decision.");
      } finally {
        setBusyId(null);
      }
    },
    [notes, onReview],
  );

  const pending = items.filter((i) => i.status === "pending");
  const decided = items.filter((i) => i.status !== "pending");

  return (
    <>
      {error ? <Notice>{error}</Notice> : null}

      {pending.length ? (
        // Label stringifies its children, so an array would render as "Pending · ,3".
        <Label>{`Pending · ${pending.length}`}</Label>
      ) : (
        <Muted>{emptyText}</Muted>
      )}

      {pending.map((item) => (
        <Card key={item.id}>
          <Text style={styles.name}>{item.employeeName}</Text>
          <Text style={styles.title}>{item.title}</Text>
          <Muted>{item.detail}</Muted>
          {item.reason ? <Text style={styles.reason}>“{item.reason}”</Text> : null}

          <TextInput
            value={notes[item.id] ?? ""}
            onChangeText={(t) => setNotes((n) => ({ ...n, [item.id]: t }))}
            placeholder="Note (optional)"
            placeholderTextColor={colors.muted}
            style={styles.note}
            editable={busyId !== item.id}
          />

          {busyId === item.id ? (
            <ActivityIndicator color={colors.brand} style={{ alignSelf: "flex-start" }} />
          ) : (
            <View style={styles.actions}>
              <Pressable
                onPress={() => review(item.id, "approved")}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: colors.ok, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Text style={styles.btnText}>Approve</Text>
              </Pressable>
              <Pressable
                onPress={() => review(item.id, "rejected")}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: colors.danger, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Text style={styles.btnText}>Reject</Text>
              </Pressable>
            </View>
          )}
        </Card>
      ))}

      {decided.length ? <Label>Reviewed</Label> : null}
      {decided.map((item) => (
        <Card key={item.id}>
          <View style={styles.decidedHead}>
            <Text style={styles.name}>{item.employeeName}</Text>
            <View
              style={[
                styles.pill,
                {
                  backgroundColor:
                    item.status === "approved" ? colors.okTint : colors.dangerTint,
                },
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: item.status === "approved" ? colors.ok : colors.danger },
                ]}
              >
                {item.status === "approved" ? "Approved" : "Rejected"}
              </Text>
            </View>
          </View>
          <Text style={styles.title}>{item.title}</Text>
          <Muted>{item.detail}</Muted>
          {item.adminNote ? <Muted>Note: {item.adminNote}</Muted> : null}
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  name: { ...type.heading, color: colors.ink },
  title: { ...type.body, color: colors.ink, fontWeight: "600" },
  reason: { ...type.body, color: colors.inkSoft, fontStyle: "italic" },
  note: {
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
  },
  actions: { flexDirection: "row", gap: spacing.sm },
  btn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  btnText: { ...type.body, color: colors.white, fontWeight: "700" },
  decidedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  pillText: { ...type.small, fontWeight: "700" },
});
