import { s } from "./lib/responsive";

/**
 * Design tokens lifted from the Attendly web app so the native client reads as
 * the same product rather than a lookalike.
 */
export const colors = {
  brand: "#6D28D9",
  brandDark: "#2E1065",
  brandTint: "#F5F3FF",
  brandBorder: "#DDD6FE",

  bg: "#F7F6FB",
  card: "#FFFFFF",
  ink: "#17141F",
  inkSoft: "#4B4560",
  muted: "#7A7290",
  rule: "#E6E1EF",

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
