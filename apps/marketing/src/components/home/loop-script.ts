/**
 * The Home hero's story, as data: one fictional week with Sam Rivera, told in
 * five beats that follow the relationship loop. The stage renders these; the
 * scroll position picks which one is live. Every name and detail is invented.
 */

export type Beat = {
  id: "capture" | "memory" | "followup" | "today" | "ask";
  title: string;
  body: string;
};

export const beats: readonly Beat[] = [
  {
    id: "capture",
    title: "Write it down.",
    body: "Right after coffee, the way you would jot it in a notebook. No form to fill in.",
  },
  {
    id: "memory",
    title: "Keep what is worth keeping.",
    body: "Tendnote suggests the Memory. You confirm it, and it stays with Sam. Nothing is saved without you.",
  },
  {
    id: "followup",
    title: "Choose when to check in.",
    body: "One line sets Friday. That is the whole plan.",
  },
  {
    id: "today",
    title: "Friday comes back to you.",
    body: "It shows up on Today as the one thing worth doing. No streaks, no badges, no backlog.",
  },
  {
    id: "ask",
    title: "Ask in your own words.",
    body: "The answer comes from what you wrote, with the source beside it.",
  },
];

export const BEAT_COUNT = beats.length;

/** The note Sam's week starts with, typed into the composer on the first beat. */
export const NOTE_TEXT =
  "Coffee with Sam. Final-round interview at a design studio on Thursday. Nervous about the portfolio review.";

export const QUESTION_TEXT = "What was Sam nervous about?";

/**
 * Where a scroll position lands in the story. `progress` is 0 at the moment the
 * stage pins and 1 at the moment it releases; each beat owns an equal slice.
 * `t` is how far through the live beat we are, for the one transition that
 * happens inside a beat (the suggested Memory being confirmed).
 */
export function beatForProgress(progress: number): { beat: number; t: number } {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const scaled = clamped * BEAT_COUNT;
  const beat = Math.min(BEAT_COUNT - 1, Math.floor(scaled));
  return { beat, t: Math.min(1, scaled - beat) };
}

/** The scroll progress that lands in the middle of a beat, for the step buttons. */
export function progressForBeat(beat: number): number {
  const index = Math.min(BEAT_COUNT - 1, Math.max(0, Math.trunc(beat)));
  return (index + 0.5) / BEAT_COUNT;
}
