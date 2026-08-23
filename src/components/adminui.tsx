import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, type } from "../theme";

/**
 * Admin design system.
 *
 * The web dashboard is a table-and-modal layout that assumes a mouse and a wide
 * screen. Ported literally it turns into 68 rows each carrying three buttons,
 * which is what the first cut looked like. So these primitives push the app the
 * other way: rows stay quiet and tappable, destructive or multi-choice actions
 * move into a bottom sheet, and long lists get a search field and filter chips
 * rather than a wall of controls.
 *
 * The employee-side kit in ./ui.tsx is untouched — those screens ship already.
 */

// ---------------------------------------------------------------- chrome

export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Pass on any pushed screen: renders the one back affordance, always left. */
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <IconButton name="chevron-back" onPress={onBack} accessibilityLabel="Go back" />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function IconButton({
  name,
  onPress,
  tone = colors.ink,
  disabled,
  accessibilityLabel,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  tone?: string;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.iconBtn,
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name={name} size={20} color={tone} />
    </Pressable>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {action}
    </View>
  );
}

// ---------------------------------------------------------------- list bits

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search",
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={16} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.searchInput}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={14} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={16} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export type Chip = { key: string; label: string; count?: number };

export function FilterChips({
  chips,
  active,
  onChange,
}: {
  chips: Chip[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
      keyboardShouldPersistTaps="handled"
    >
      {chips.map((c) => {
        const on = c.key === active;
        return (
          <Pressable
            key={c.key}
            onPress={() => onChange(c.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [
              styles.chip,
              on ? styles.chipOn : null,
              { opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={[styles.chipText, on ? styles.chipTextOn : null]}>
              {c.count === undefined ? c.label : `${c.label} ${c.count}`}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Segmented({
  options,
  active,
  onChange,
}: {
  options: Chip[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const on = o.key === active;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.segmentItem, on ? styles.segmentItemOn : null]}
          >
            <Text style={[styles.segmentText, on ? styles.segmentTextOn : null]}>
              {o.count === undefined ? o.label : `${o.label} ${o.count}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  // Deterministic hue per person: the same face keeps the same colour across
  // reloads, which makes a long list scannable without photos.
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue} 60% 92%)` },
      ]}
    >
      <Text style={[styles.avatarText, { color: `hsl(${hue} 45% 32%)`, fontSize: size * 0.36 }]}>
        {initials || "?"}
      </Text>
    </View>
  );
}

export function StatusPill({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** One tappable row. Everything heavier lives behind it in a Sheet. */
export function Row({
  title,
  subtitle,
  meta,
  left,
  right,
  onPress,
  titleLines = 1,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  /**
   * Rows in a scannable list stay one line so every row is the same height.
   * Raise it where the title carries meaning that must not be clipped — a
   * notification title ends in "punched in" / "punched out", and a long name
   * would otherwise truncate away the very thing the row is reporting.
   */
  titleLines?: number;
}) {
  const body = (
    <>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.muted} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

export function StatStrip({
  stats,
}: {
  stats: Array<{ label: string; value: number | string; tone?: string }>;
}) {
  return (
    <View style={styles.statStrip}>
      {stats.map((s, i) => (
        <React.Fragment key={s.label}>
          {i ? <View style={styles.statDivider} /> : null}
          <View style={styles.stat}>
            <Text style={[styles.statValue, s.tone ? { color: s.tone } : null]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label.toUpperCase()}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

export function EmptyState({
  icon = "file-tray-outline",
  title,
  body,
}: {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body?: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={34} color={colors.muted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}

// ---------------------------------------------------------------- sheet

/**
 * Bottom sheet. Every multi-choice or destructive action goes through one of
 * these rather than sitting inline on a list row, which is what kept the roster
 * unreadable at 68 people.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {title}
          </Text>
          <IconButton name="close" onPress={onClose} accessibilityLabel="Close" />
        </View>
        <ScrollView
          contentContainerStyle={styles.sheetBody}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function SheetAction({
  icon,
  label,
  tone = colors.ink,
  onPress,
  busy,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  tone?: string;
  onPress: () => void;
  busy?: boolean;
  /** Set while a SIBLING action is running: two writes for the same record
   *  racing each other is decided by whichever the server commits last. */
  disabled?: boolean;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [styles.sheetAction, { opacity: off ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tone} />
      ) : (
        <Ionicons name={icon} size={19} color={tone} />
      )}
      <Text style={[styles.sheetActionText, { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- forms

export function FormField({
  label,
  hint,
  required,
  ...rest
}: TextInputProps & { label: string; hint?: string; required?: boolean }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.formLabel}>
        {label.toUpperCase()}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </Text>
      <TextInput
        {...rest}
        placeholderTextColor={colors.muted}
        style={[styles.input, rest.multiline ? { height: 88, textAlignVertical: "top" } : null]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Options as chips — a phone-friendly stand-in for the web's <select>. */
export function FormSelect({
  label,
  options,
  value,
  onChange,
  required,
}: {
  label: string;
  options: Array<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
  required?: boolean;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.formLabel}>
        {label.toUpperCase()}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </Text>
      <View style={styles.optionWrap}>
        {options.map((o) => {
          const on = o.key === value;
          return (
            <Pressable
              key={o.key}
              onPress={() => onChange(o.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [
                styles.option,
                on ? styles.optionOn : null,
                { opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Text style={[styles.optionText, on ? styles.optionTextOn : null]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function FormSwitch({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.switchLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.brand, false: colors.rule }}
        thumbColor={colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: { ...type.display, color: colors.ink, fontSize: 26 },
  // inkSoft, not muted: these sit on colors.bg, where muted measures 4.21:1.
  headerSub: { ...type.small, color: colors.inkSoft, marginTop: 2 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  sectionTitle: { ...type.label, color: colors.inkSoft },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  searchInput: { flex: 1, ...type.body, color: colors.ink, padding: 0 },

  chipRow: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { ...type.small, color: colors.inkSoft, fontWeight: "600" },
  chipTextOn: { color: colors.white },

  segment: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  segmentItemOn: { backgroundColor: colors.brandTint },
  segmentText: { ...type.small, color: colors.inkSoft, fontWeight: "600" },
  segmentTextOn: { color: colors.brand },

  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700" },

  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { ...type.small, fontWeight: "700", fontSize: 12 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowTitle: { ...type.heading, color: colors.ink },
  rowSub: { ...type.small, color: colors.inkSoft },
  rowMeta: { ...type.small, color: colors.muted, fontSize: 12 },

  statStrip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.rule },
  statValue: { ...type.title, color: colors.ink, fontSize: 21 },
  statLabel: { ...type.label, color: colors.muted, fontSize: 10 },

  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyTitle: { ...type.heading, color: colors.inkSoft },
  emptyBody: { ...type.small, color: colors.muted, textAlign: "center" },

  scrim: { flex: 1, backgroundColor: "rgba(23,20,31,0.45)" },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "85%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.rule,
    marginTop: spacing.sm,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sheetTitle: { ...type.title, color: colors.ink, flex: 1 },
  sheetBody: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  sheetAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sheetActionText: { ...type.body, fontWeight: "600" },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  detailLabel: { ...type.small, color: colors.muted },
  detailValue: { ...type.body, color: colors.ink, fontWeight: "600", flexShrink: 1, textAlign: "right" },

  formLabel: { ...type.label, color: colors.muted },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...type.body,
    color: colors.ink,
  },
  hint: { ...type.small, color: colors.muted, fontSize: 12 },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  optionOn: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  optionText: { ...type.small, color: colors.inkSoft, fontWeight: "600" },
  optionTextOn: { color: colors.brand },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  switchLabel: { ...type.body, color: colors.ink, fontWeight: "600" },
});
