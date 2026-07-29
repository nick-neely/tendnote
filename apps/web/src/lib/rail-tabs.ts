/** The panels the dashboard rail offers, in the order its tab bar shows them. */
export type RailTab = "today" | "review" | "followups" | "people";

/**
 * Which rail panel opens when the URL names none.
 *
 * A fixed default hid the product: the rail opened on Today whether or not Today
 * had anything, so an owner with five near reminders and six things to review
 * landed on an empty panel and had to go looking. The rail opens instead on the
 * first panel that holds something, in the order the tabs read - so Today wins
 * whenever it has content, and the choice never contradicts what the eye expects
 * from the tab bar.
 *
 * People is never a default. It is recall, always full for anyone with a
 * notebook, and would therefore always win the fallback while telling the owner
 * nothing about what is waiting. When nothing is waiting anywhere, Today is the
 * honest landing: its empty state offers the brief, and capture sits beside it.
 *
 * Deciding this on the server is the point: a client-side correction after the
 * data arrives would move the panel under the owner's cursor.
 *
 * Takes counts rather than flags so the caller only has to add up what it already
 * loaded, with no judgement about emptiness left on its side.
 */
export function defaultRailTab(waiting: {
  today: number;
  followups: number;
  review: number;
}): RailTab {
  if (waiting.today > 0) return "today";
  if (waiting.followups > 0) return "followups";
  if (waiting.review > 0) return "review";
  return "today";
}
