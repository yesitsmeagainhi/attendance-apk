import { s } from "./lib/responsive";

/**
 * Design tokens derived from the ASM Vikas logo:
 *   primary  — deep navy  #1A2D62  (the letterforms)
 *   accent   — teal       #2D8B7A  (the checkmark swoosh on the M)
 */
export const colors = {
  brand: "#1A2D62",
  brandDark: "#0D1A3D",
  brandTint: "#EEF1FA",
  brandBorder: "#C4CEEB",

  accent: "#2D8B7A",
  accentTint: "#E5F4F1",
  accentBorder: "#A8D5CE",

  bg: "#F3F5FB",
  card: "#FFFFFF",
  ink: "#0D1A3D",
  inkSoft: "#354070",
  muted: "#7882AA",
  rule: "#DDE3F0",

  ok: "#15803D",
  okTint: "#E8F5EC",
  warn: "#B45309",
  warnTint: "#FDF3E3",
  danger: "#B91C1C",
  dangerTint: "#FCECEC",

  white: "#FFFFFF",
} as const;

export const spacing = {
  xs: s(4),
  sm: s(8),
  md: s(12),
  lg: s(16),
  xl: s(24),
  xxl: s(32),
};

export const radius = {
  sm: s(8),
  md: s(12),
  lg: s(16),
  pill: 999,
};

export const type = {
  display: { fontSize: s(28), fontWeight: "700" as const, letterSpacing: -0.5 },
  title: { fontSize: s(20), fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: s(16), fontWeight: "600" as const },
  body: { fontSize: s(15), fontWeight: "400" as const },
  small: { fontSize: s(13), fontWeight: "400" as const },
  label: { fontSize: s(11), fontWeight: "600" as const, letterSpacing: 0.8 },
};

/** Maps the status strings the history API returns to a colour pair. */
export function statusColors(status: string): { fg: string; bg: string } {
  switch (status) {
    case "Present":
    case "On Time":
      return { fg: colors.ok, bg: colors.okTint };
    case "Late":
    case "Half Day":
    case "Short Day":
      return { fg: colors.warn, bg: colors.warnTint };
    case "Absent":
      return { fg: colors.danger, bg: colors.dangerTint };
    default:
      return { fg: colors.inkSoft, bg: colors.bg };
  }
}
