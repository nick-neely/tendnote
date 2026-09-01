import type { z } from "zod";
import type { ApprovalSubject, ApprovalSubjectLookup } from "./types";

/** Longest title a describer may produce, including the ellipsis. */
export const APPROVAL_SUBJECT_TITLE_MAX_LENGTH = 120;

/** Longest single-line detail a describer may produce, including the ellipsis. */
export const APPROVAL_SUBJECT_LINE_MAX_LENGTH = 160;

/**
 * Longest line of a body shown in full by {@link paragraphs}, and the ceiling
 * every line is held to. A message is read, not skimmed, so its paragraphs get
 * room a labelled field does not; a paragraph longer than this is split across
 * lines rather than cut.
 */
export const APPROVAL_SUBJECT_PARAGRAPH_MAX_LENGTH = 600;

/** Most of a body one approval will show before it says how much is left. */
export const APPROVAL_SUBJECT_BODY_MAX_LENGTH = 4000;

/**
 * One tool's describer: untrusted input plus the authenticated owner, in; a
 * lookup, out. Never throws - a store outage is `missing`, which fails closed.
 */
export type ApprovalSubjectDescriber = (
  input: unknown,
  ownerUserId: string,
) => Promise<ApprovalSubjectLookup>;

export type ApprovalSubjectDescribers = Readonly<Record<string, ApprovalSubjectDescriber>>;

/**
 * Builds a describer from a per-tool input schema, an owner-scoped load, and a
 * rendering of the result.
 *
 * The three are separate on purpose. The schema is a *subset* of the tool's own
 * input schema covering only the fields the description needs, so the registry
 * does not have to be re-synchronised every time a tool grows an optional
 * argument. The load is an existing `@tendnote/db` query entry point, never a
 * raw read by id, so "is this the caller's record?" is answered by the same
 * visibility rules the mutation will apply. The rendering is pure text.
 */
export function defineSubject<TInput, TRecord>(spec: {
  readonly schema: z.ZodType<TInput>;
  readonly load: (input: TInput, ownerUserId: string) => Promise<TRecord | null | undefined>;
  readonly describe: (record: TRecord, input: TInput) => ApprovalSubject;
}): ApprovalSubjectDescriber {
  return async (input, ownerUserId) => {
    const parsed = spec.schema.safeParse(input);
    if (!parsed.success) return { kind: "missing" };

    const record = await spec.load(parsed.data, ownerUserId);
    if (record === null || record === undefined) return { kind: "missing" };

    return { kind: "described", subject: bounded(spec.describe(record, parsed.data)) };
  };
}

/** One legible line: collapsed whitespace, bounded length, or nothing at all. */
export function line(text: string, max = APPROVAL_SUBJECT_LINE_MAX_LENGTH): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/**
 * A body, whole, as the lines it is actually written in.
 *
 * {@link detail} is right for a field and wrong for a message: it collapses the
 * text to one 160-character line, so "save this to Gmail" asked the owner to
 * authorise sending something they could only read the first sentence of. The
 * risk in an external write is the wording, so the wording is what the card has
 * to carry. Paragraph breaks survive as separate lines, a paragraph longer than
 * {@link APPROVAL_SUBJECT_PARAGRAPH_MAX_LENGTH} is split across lines rather
 * than cut, and only past {@link APPROVAL_SUBJECT_BODY_MAX_LENGTH} does the text
 * stop — saying, in the last line, exactly how much was not shown, because an
 * approval that quietly hides the end of a message is worse than one that admits
 * it.
 */
export function paragraphs(label: string, text: string | null | undefined): string[] {
  const body = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (body === "") return [];

  const blocks = body
    .split(/\n+/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block !== "");

  const shown: string[] = [];
  let budget = APPROVAL_SUBJECT_BODY_MAX_LENGTH;
  let dropped = 0;

  for (const block of blocks) {
    if (budget <= 0) {
      dropped += block.length;
      continue;
    }
    const kept = block.slice(0, budget);
    dropped += block.length - kept.length;
    budget -= kept.length;
    // Only the very first line emitted carries the `"<label>: "` prefix, so
    // that line is wrapped short by exactly the prefix it is about to grow by.
    // Wrapping every line to the full ceiling and then prefixing pushed the
    // first one past it, and `bounded` - the last word on length - answered by
    // cutting the tail off with an ellipsis: a long first paragraph of a Gmail
    // draft lost its end silently, in the one approval where the wording is the
    // whole risk.
    shown.push(
      ...wrap(
        kept,
        APPROVAL_SUBJECT_PARAGRAPH_MAX_LENGTH,
        shown.length === 0 ? labelledLineMax(label) : undefined,
      ),
    );
  }

  const [first, ...rest] = shown;
  if (first === undefined) return [];

  return [
    `${label}: ${first}`,
    ...rest,
    // `dropped` counts whitespace-collapsed characters: each block has already
    // had its runs of whitespace squeezed to single spaces, and the paragraph
    // breaks between blocks are not counted at all. The number therefore
    // describes the text as this function would have shown it, not the raw
    // stored body, which may be longer.
    ...(dropped > 0 ? [`… (${dropped} more characters)`] : []),
  ];
}

/**
 * Room left for the first line of a body once `"<label>: "` is in front of it.
 * Floored at one character so a pathologically long label cannot hand `wrap` a
 * width it can make no progress against.
 */
function labelledLineMax(label: string): number {
  return Math.max(1, APPROVAL_SUBJECT_PARAGRAPH_MAX_LENGTH - `${label}: `.length);
}

/**
 * One paragraph as lines of at most `max`, broken at a space where there is one.
 * `firstMax` narrows the first line alone, for the one that gets a label.
 */
function wrap(text: string, max: number, firstMax = max): string[] {
  const lines: string[] = [];
  let rest = text;
  let limit = firstMax;

  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    const space = window.lastIndexOf(" ");
    const cut = space > limit / 2 ? space : limit;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
    limit = max;
  }
  if (rest !== "") lines.push(rest);

  return lines;
}

/** A labelled detail line, or nothing when there is no value to show. */
export function detail(label: string, value: string | null | undefined): string | null {
  const text = value === null || value === undefined ? "" : line(value);
  return text === "" ? null : line(`${label}: ${text}`);
}

/** Assembles a subject from a title and detail lines, dropping the empty ones. */
export function subject(
  title: string,
  lines: readonly (string | null | undefined)[],
): ApprovalSubject {
  return {
    title,
    lines: lines.filter((entry): entry is string => typeof entry === "string" && entry !== ""),
  };
}

/** A date the owner can read, or nothing when there is not one. */
export function whenText(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * The record, but only if this owner owns it.
 *
 * Several read entry points answer by *visibility* — a household member may see
 * a shared follow-up — while the mutation behind the approval is owner-only. The
 * approval must not park on a record the call could never change, so the
 * owner-only tools narrow the read here rather than discovering it afterwards.
 */
export function ownedBy<T extends { ownerUserId?: string | null }>(
  record: T | null | undefined,
  ownerUserId: string,
): T | null {
  if (!record) return null;
  return record.ownerUserId === ownerUserId ? record : null;
}

/**
 * The last word on length.
 *
 * Every labelled field is already bounded at {@link APPROVAL_SUBJECT_LINE_MAX_LENGTH}
 * by {@link line} and {@link detail} where it is built; this is the ceiling no
 * line may pass whatever produced it, which is the paragraph bound rather than
 * the field bound because {@link paragraphs} lines legitimately run longer.
 */
function bounded(value: ApprovalSubject): ApprovalSubject {
  return {
    title: line(value.title, APPROVAL_SUBJECT_TITLE_MAX_LENGTH),
    lines: value.lines
      .map((entry) => line(entry, APPROVAL_SUBJECT_PARAGRAPH_MAX_LENGTH))
      .filter((entry) => entry !== ""),
  };
}
