import type { GlobalRecallResult } from "@tendnote/domain/global-recall";

/**
 * The two lines a Global Recall result row shows: what it leads with, and what
 * it trails with.
 *
 * For almost every family the shared normalizer's `label` is the headline and
 * `supportingText` is the context, and this is a pass-through. Memories and
 * logged context are the exception: their label is *the person they are about*,
 * so a search for a name renders "Jordan Rivera" as the person row's headline
 * and "Jordan Rivera" again as the headline of every memory about them - one
 * record apparently listed several times, with nothing on screen to tell the
 * rows apart. The row leads instead with what was actually remembered and lets
 * the person be the context beneath it, which reads correctly whether the
 * surface groups by family (the desktop palette, under "Memories") or by match
 * strength (the phone's Search flow, under "Exact" and "Related") - the person's
 * name is still on the row either way.
 *
 * Deliberately a presentation rule, not a change to
 * `packages/db/.../result-normalizers.ts`: that label is a shared contract the
 * phone flow, the palette, and Eve's recall tool all read, and Eve wants the
 * person first. Both owner-facing surfaces read this one function instead, so
 * they can never drift into disagreeing about what a memory row says.
 */
export type RecallResultLines = {
  /** The headline. Always present - both source fields are non-empty by schema. */
  primary: string;
  /** The context line, or `null` when it would only repeat the headline. */
  secondary: string | null;
};

export function recallResultLines(result: GlobalRecallResult): RecallResultLines {
  const { primary, secondary } =
    result.family === "relationship_context"
      ? {
          primary: result.supportingText,
          // `personDisplayName` is nullable; the normalizer's label is the same
          // name when it is there to be had, so it is the honest fallback.
          secondary: result.details.personDisplayName ?? result.label,
        }
      : { primary: result.label, secondary: result.supportingText };
  // A row never says the same thing twice.
  return { primary, secondary: secondary === primary ? null : secondary };
}
