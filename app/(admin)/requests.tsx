import React, { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { ApiError } from "../../src/api/client";
import {
  adminApi,
  AdminLeaveRequest,
  AdminMissPunchRequest,
  ReviewAction,
} from "../../src/api/admin";
import { Notice } from "../../src/components/ui";
import { ScreenHeader, SearchBar, Segmented } from "../../src/components/adminui";
import { ReviewList, ReviewItem } from "../../src/components/ReviewList";
import { colors, spacing } from "../../src/theme";
import { formatDate } from "../../src/lib/punch";

const LEAVE_LABEL: Record<AdminLeaveRequest["leaveType"], string> = {
  sick: "Sick leave",
  casual: "Casual leave",
  earned: "Earned leave",
};

/**
 * Approvals. The web keeps miss-punch and leave on two separate tabs; on a
 * phone that would spend two of five tab slots on the same job, so they share
 * one screen behind a segmented control with pending counts on the labels.
 */
export default function AdminRequestsScreen() {
  const [tab, setTab] = useState<"miss" | "leave">("miss");
  const [missPunches, setMissPunches] = useState<AdminMissPunchRequest[]>([]);
  const [leaves, setLeaves] = useState<AdminLeaveRequest[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      // Both lists load together so the segment labels can carry live counts.
      const [mp, lv] = await Promise.all([adminApi.missPunches(), adminApi.leaves()]);
      setMissPunches(mp.requests);
      setLeaves(lv.requests);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const reviewMiss = useCallback(
    async (requestId: string, action: ReviewAction, adminNote: string) => {
      await adminApi.reviewMissPunch({ requestId, action, adminNote: adminNote || undefined });
      await load();
    },
    [load],
  );

  const reviewLeave = useCallback(
    async (requestId: string, action: ReviewAction, adminNote: string) => {
      await adminApi.reviewLeave({ requestId, action, adminNote: adminNote || undefined });
      await load();
    },
    [load],
  );

  const missItems: ReviewItem[] = useMemo(
    () =>
      missPunches.map((r) => ({
        id: r.id,
        employeeName: r.employeeName,
        title: `Missed punch ${r.punchType === "IN" ? "in" : "out"} · ${r.requestedTime}`,
        detail: formatDate(r.date),
        reason: r.reason,
        status: r.status,
        adminNote: r.adminNote,
      })),
    [missPunches],
  );

  const leaveItems: ReviewItem[] = useMemo(
    () =>
      leaves.map((r) => ({
        id: r.id,
        employeeName: r.employeeName,
        title: LEAVE_LABEL[r.leaveType] ?? r.leaveType,
        detail:
          r.fromDate === r.toDate
            ? formatDate(r.fromDate)
            : `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}`,
        reason: r.reason,
        status: r.status,
        adminNote: r.adminNote,
      })),
    [leaves],
  );

  const items = tab === "miss" ? missItems : leaveItems;
  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter(
        (i) =>
          i.employeeName.toLowerCase().includes(q) ||
          i.title.toLowerCase().includes(q) ||
          i.reason.toLowerCase().includes(q),
      )
    : items;

  const pendingMiss = missItems.filter((i) => i.status === "pending").length;
  const pendingLeave = leaveItems.filter((i) => i.status === "pending").length;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="Requests"
        subtitle={
          pendingMiss + pendingLeave
            ? `${pendingMiss + pendingLeave} waiting for review`
            : "Nothing waiting"
        }
      />

      <View style={styles.controls}>
        <Segmented
          options={[
            { key: "miss", label: "Miss-punch", count: pendingMiss || undefined },
            { key: "leave", label: "Leave", count: pendingLeave || undefined },
          ]}
          active={tab}
          onChange={(k) => setTab(k as "miss" | "leave")}
        />
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search name or reason" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}
        <ReviewList
          items={visible}
          onReview={tab === "miss" ? reviewMiss : reviewLeave}
          emptyText={
            q
              ? "Nothing matches that search."
              : tab === "miss"
                ? "No miss-punch requests waiting."
                : "No leave requests waiting."
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  controls: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
});
