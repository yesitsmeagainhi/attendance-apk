import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, ApiError, Payslip, PayslipSummary } from "../src/api/client";
import { Muted, Notice, Title } from "../src/components/ui";
import { colors, radius, spacing, type } from "../src/theme";
import { s } from "../src/lib/responsive";
import { payslipDetails, payslipTable, PayslipRow, rupees } from "../src/lib/payslip";

/**
 * Monthly payslips the admin has published (same data as the web panel).
 * Plain black-and-white layout, like the printed slip: company, employee
 * details, earnings, deductions, net pay and net pay in words.
 */
export default function PayslipsScreen() {
  const router = useRouter();
  const [list, setList] = useState<PayslipSummary[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [slip, setSlip] = useState<Payslip | null>(null);
  const [loadingSlip, setLoadingSlip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(async () => {
    try {
      setError(null);
      const res = await api.payslips();
      setList(res.payslips);
      setMonth((m) => (m && res.payslips.some((p) => p.month === m) ? m : res.payslips[0]?.month ?? null));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your payslips.");
      setList((l) => l ?? []);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    if (!month) { setSlip(null); return; }
    let cancelled = false;
    setLoadingSlip(true);
    api.payslip(month)
      .then((r) => { if (!cancelled) setSlip(r.payslip); })
      .catch((e) => { if (!cancelled) { setSlip(null); setError(e instanceof ApiError ? e.message : "Couldn't load this payslip."); } })
      .finally(() => { if (!cancelled) setLoadingSlip(false); });
    return () => { cancelled = true; };
  }, [month]);

  async function onRefresh() {
    setRefreshing(true);
    await loadList();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={s(24)} color={colors.ink} />
        </Pressable>
        <Title>Payslips</Title>
        <View style={{ width: s(24) }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {error ? <Notice>{error}</Notice> : null}

        {list === null ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
        ) : list.length === 0 ? (
          <Muted>
            No payslips yet. Your payslip for a month appears here once it’s published, usually on the 1st of the next month.
          </Muted>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.months}>
            {list.map((p) => {
              const on = p.month === month;
              return (
                <Pressable
                  key={p.month}
                  onPress={() => setMonth(p.month)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  style={[styles.monthChip, on && styles.monthChipOn]}
                >
                  <Text style={[styles.monthText, on && styles.monthTextOn]}>{p.monthLabel}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {loadingSlip ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} /> : null}
        {slip && !loadingSlip ? <PayslipView slip={slip} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PayslipView({ slip }: { slip: Payslip }) {
  const t = payslipTable(slip);
  const details = payslipDetails(slip);
  return (
    <View style={styles.paper}>
      <View style={styles.head}>
        <Text style={styles.company}>{slip.company?.name || "Payslip"}</Text>
        {slip.company?.address ? <Text style={styles.address}>{slip.company.address}</Text> : null}
        <Text style={styles.period}>Payslip for {slip.monthLabel}</Text>
      </View>

      <View style={styles.details}>
        {details.map(([k, v]) => (
          <View key={k} style={styles.detailRow}>
            <Text style={styles.detailKey}>{k}</Text>
            <Text style={styles.detailVal}>{v}</Text>
          </View>
        ))}
      </View>

      <Section title="Earnings" rows={t.earnings} total={t.totalEarnings} totalLabel="Total earnings" />
      <Section title="Deductions" rows={t.deductions} total={t.totalDeductions} totalLabel="Total deductions" empty="No deductions" />

      <View style={styles.net}>
        <Text style={styles.netLabel}>Net pay</Text>
        <Text style={styles.netAmount}>{rupees(t.netPay)}</Text>
      </View>
      <Text style={styles.words}>{t.netPayWords}</Text>
      <Text style={styles.footnote}>Net pay = total earnings − total deductions.</Text>
    </View>
  );
}

function Section({ title, rows, total, totalLabel, empty }: {
  title: string; rows: PayslipRow[]; total: number; totalLabel: string; empty?: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionTitle}>Amount</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.note}>{empty ?? "None"}</Text>
      ) : rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={styles.line}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineLabel}>{r.label}</Text>
            {r.note ? <Text style={styles.note}>{r.note}</Text> : null}
          </View>
          <Text style={styles.lineAmount}>{rupees(r.amount)}</Text>
        </View>
      ))}
      <View style={[styles.line, styles.totalLine]}>
        <Text style={styles.totalLabel}>{totalLabel}</Text>
        <Text style={styles.totalAmount}>{rupees(total)}</Text>
      </View>
    </View>
  );
}

const INK = "#111111";
const SOFT = "#555555";
const LINE = "#D4D4D4";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.lg, paddingBottom: spacing.xxl },
  months: { gap: spacing.sm },
  monthChip: {
    paddingHorizontal: spacing.lg, paddingVertical: s(9), borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.rule,
  },
  monthChipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  monthText: { ...type.small, color: colors.inkSoft, fontWeight: "600" },
  monthTextOn: { color: colors.white },

  paper: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: LINE, borderRadius: radius.sm, padding: spacing.lg, gap: spacing.lg },
  head: { alignItems: "center", gap: s(2), borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: spacing.md },
  company: { fontSize: s(18), fontWeight: "700", color: INK, textAlign: "center" },
  address: { ...type.small, color: SOFT, textAlign: "center" },
  period: { ...type.body, fontWeight: "600", color: INK, marginTop: spacing.xs },

  details: { gap: s(6) },
  detailRow: { flexDirection: "row", gap: spacing.md },
  detailKey: { ...type.small, color: SOFT, width: s(118) },
  detailVal: { ...type.small, color: INK, fontWeight: "600", flex: 1 },

  section: { borderWidth: 1, borderColor: LINE },
  sectionHead: {
    flexDirection: "row", justifyContent: "space-between",
    backgroundColor: "#F2F2F2", paddingHorizontal: spacing.md, paddingVertical: s(7),
    borderBottomWidth: 1, borderBottomColor: LINE,
  },
  sectionTitle: { ...type.small, fontWeight: "700", color: INK },
  line: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: s(8), borderBottomWidth: 1, borderBottomColor: LINE,
  },
  lineLabel: { ...type.small, color: INK, fontWeight: "600" },
  note: { fontSize: s(12), color: SOFT, paddingHorizontal: 0, paddingVertical: s(2) },
  lineAmount: { ...type.small, color: INK, fontVariant: ["tabular-nums"] },
  totalLine: { borderBottomWidth: 0 },
  totalLabel: { ...type.small, color: INK, fontWeight: "700", flex: 1 },
  totalAmount: { ...type.small, color: INK, fontWeight: "700", fontVariant: ["tabular-nums"] },

  net: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderWidth: 2, borderColor: INK, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  netLabel: { ...type.heading, color: INK, fontWeight: "700" },
  netAmount: { fontSize: s(20), color: INK, fontWeight: "700", fontVariant: ["tabular-nums"] },
  words: { ...type.small, color: INK, fontStyle: "italic", marginTop: -spacing.sm },
  footnote: { fontSize: s(11), color: SOFT },
});
