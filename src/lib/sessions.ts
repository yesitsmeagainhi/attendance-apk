/**
 * Groups a flat array of punches into paired sessions (IN → OUT).
 * Used on the home screen for flexible-hours employees who punch
 * multiple times per day across different branches.
 */

type Punch = { type: "IN" | "OUT"; time: string; office: string; photoKey: string };

export type Session = {
  index: number; // 1-based
  punchIn: { time: string; office: string; photoKey: string };
  punchOut: { time: string; office: string; photoKey: string } | null;
  durationMinutes: number | null; // null when ongoing
};

export type SessionSummary = {
  sessions: Session[];
  completedCount: number;
  totalMinutes: number;
  currentSession: Session | null; // the ongoing one, if any
  nextSessionNumber: number; // for labeling the punch button
};

function parseUTC(raw: string): Date {
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
}

export function groupPunchesIntoSessions(punches: Punch[]): SessionSummary {
  const sessions: Session[] = [];
  let idx = 0;

  // Skip any leading orphan OUT punches (shouldn't happen, but defensive)
  while (idx < punches.length && punches[idx].type === "OUT") idx++;

  while (idx < punches.length) {
    const p = punches[idx];

    if (p.type === "IN") {
      const session: Session = {
        index: sessions.length + 1,
        punchIn: { time: p.time, office: p.office, photoKey: p.photoKey },
        punchOut: null,
        durationMinutes: null,
      };

      // Look for the matching OUT
      if (idx + 1 < punches.length && punches[idx + 1].type === "OUT") {
        const out = punches[idx + 1];
        session.punchOut = { time: out.time, office: out.office, photoKey: out.photoKey };
        const diffMs = parseUTC(out.time).getTime() - parseUTC(p.time).getTime();
        session.durationMinutes = Math.max(0, Math.round(diffMs / 60_000));
        idx += 2;
      } else {
        // No matching OUT — ongoing session
        idx += 1;
      }

      sessions.push(session);
    } else {
      // Orphan OUT in the middle — skip it
      idx += 1;
    }
  }

  const completed = sessions.filter((s) => s.punchOut !== null);
  const current = sessions.find((s) => s.punchOut === null) ?? null;

  return {
    sessions,
    completedCount: completed.length,
    totalMinutes: completed.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
    currentSession: current,
    nextSessionNumber: current ? current.index : sessions.length + 1,
  };
}
