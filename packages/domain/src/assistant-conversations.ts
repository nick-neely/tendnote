/**
 * How an Assistant conversation is named, decided once for everyone who names one.
 *
 * A thread's title is written in three places — the browser the instant eve
 * mints a session id, the row the web action upserts, and the model title the
 * agent hook lands when the first turn completes (ADR 0238) — and the first two
 * must produce byte-identical text or the rail visibly rewrites itself a moment
 * after the person hits send. So the clipping rules live here rather than in
 * `@tendnote/db`, which reaches the database client and therefore cannot be
 * imported into the browser at all.
 *
 * Deliberately pure, like `./assistant-sources`: no database, no I/O, nothing
 * that assumes a server. The db query module re-exports every name below, so
 * server callers keep importing it from where the rows are.
 */

/** Enough of the opening message to regenerate a title without replaying Eve's stream. */
export const ASSISTANT_CONVERSATION_FIRST_MESSAGE_MAX_LENGTH = 500;

/** A rail entry, not a sentence: long enough to be specific, short enough to read at a glance. */
export const ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH = 120;

/** The placeholder is a clipped first message, so it stops well before the stored title cap. */
export const ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH = 60;

/**
 * Shown when the opening message carries no text of its own — an attachment-only
 * turn, or one whose text is entirely whitespace.
 */
export const ASSISTANT_CONVERSATION_FALLBACK_TITLE = "New conversation";

/** Below this, a word-boundary cut would throw away most of the placeholder. */
const MIN_WORD_BOUNDARY_OFFSET = 24;

/**
 * How the current title was produced, and therefore whether it may be replaced.
 *
 * Only a `placeholder` is ever overwritten. `model` is the five-word title the
 * first-turn hook wrote; `owner` is a rename the person typed themselves. The
 * two are told apart rather than folded together because "the model named this"
 * and "I named this" are different facts about the same row — a future
 * re-titling pass may revisit the model's work and must never revisit theirs.
 */
export type AssistantConversationTitleSource = "placeholder" | "model" | "owner";

/** Collapse the newlines a composer produces so a title stays one line. */
function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clipToCodePoints(text: string, limit: number): string {
  const points = [...text];
  return points.length <= limit ? text : points.slice(0, limit).join("");
}

/**
 * The immediate, free title: the owner's own opening words, clipped on a word
 * boundary. It costs nothing and is right often enough that the model title
 * that replaces it reads as a refinement rather than a correction.
 */
export function placeholderConversationTitle(firstMessage: string): string {
  const normalized = normalizeMessageText(firstMessage);
  if (!normalized) return ASSISTANT_CONVERSATION_FALLBACK_TITLE;

  const points = [...normalized];
  if (points.length <= ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH) return normalized;

  const clipped = points.slice(0, ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH).join("");
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace >= MIN_WORD_BOUNDARY_OFFSET ? clipped.slice(0, lastSpace) : clipped;

  return `${base.replace(/[\s.,;:!?—–-]+$/u, "")}…`;
}

/** The stored form of the opening message: one line, capped, or `null` when empty. */
export function normalizeFirstMessage(firstMessage: string | null | undefined): string | null {
  const normalized = normalizeMessageText(firstMessage ?? "");
  if (!normalized) return null;

  return clipToCodePoints(normalized, ASSISTANT_CONVERSATION_FIRST_MESSAGE_MAX_LENGTH);
}

/** The stored form of a title, whoever authored it. Never empty, never overlong. */
export function normalizeConversationTitle(title: string): string {
  const normalized = normalizeMessageText(title);
  if (!normalized) return ASSISTANT_CONVERSATION_FALLBACK_TITLE;

  return clipToCodePoints(normalized, ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH);
}
