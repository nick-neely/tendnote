import { z } from "zod";
import {
  type ContextFactCategory,
  type ContextFactView,
  contextFactCategoryLabel,
  contextFactCategorySchema,
  contextFactProvenanceSchema,
  isPreciseAddressContextFactContent,
  isRestrictedContextFactDisclosure,
} from "./context-facts";
import { type Sensitivity, sensitivitySchema } from "./privacy";

/**
 * The order the shared page reads in.
 *
 * Composition, Location, Preference, and Constraint lead because they are what a
 * household actually needs from each other day to day; the rest follow in the
 * Self Context order so the two management surfaces do not teach two different
 * category models. No category is mandatory and an empty one is never rendered,
 * so this is a reading order rather than a checklist to complete.
 */
export const householdContextCategories = [
  "composition",
  "location",
  "preference",
  "constraint",
  "background",
  "work",
  "interest",
  "other",
] as const satisfies readonly ContextFactCategory[];

export type HouseholdContextCategory = (typeof householdContextCategories)[number];

export const householdContextCategoryOptions = householdContextCategories.map((value) => ({
  value,
  label: contextFactCategoryLabel(value),
}));

/**
 * What a member is told before a statement becomes visible to everyone.
 *
 * `normal` returns `null` deliberately: the whole page is household-visible and
 * saying so on every save would train people to click past the sentence that
 * matters. The warning is spent only where the content itself is the surprise.
 */
export function householdContextAudienceWarning(sensitivity: Sensitivity): string | null {
  if (sensitivity === "sensitive") {
    return "Everyone in the household will be able to read this, and Eve may bring it up when it's relevant. Keep the wording something you'd say to all of them.";
  }
  if (sensitivity === "restricted") {
    return "Everyone in the household will be able to read this. Eve never raises it on its own — only when someone asks for it directly.";
  }
  return null;
}

/** The one deliberate pause before a current shared fact stops being current. */
export const HOUSEHOLD_CONTEXT_ARCHIVE_NOTICE =
  "Archiving takes this out of what everyone sees and out of Eve's orientation. It stays here, and anyone in the household can restore it.";

/**
 * Nobody can permanently delete a household-owned fact, said where someone would
 * otherwise go looking for the control (household context management doc).
 */
export const HOUSEHOLD_CONTEXT_NO_DELETE_NOTICE =
  "Archive is how facts leave this page. No one person can delete a household fact outright.";

/**
 * One person in the household, as attribution sees them.
 *
 * A departed member keeps their name and loses their standing rather than
 * disappearing: their contributions are still the household's, and rewriting the
 * history of who said what is exactly what departure must not do.
 */
export type HouseholdContextActorIdentity = {
  userId: string;
  name: string;
  isActiveMember: boolean;
};

/**
 * How one actor is named in a provenance line.
 *
 * An unknown id becomes "someone who's left" rather than the raw id: an opaque
 * identifier in a sentence is both a leak and unreadable, and the honest answer
 * to "who wrote this" for a person nobody here can name is that they are gone.
 */
export function householdContextActorLabel(input: {
  userId: string;
  viewerUserId: string;
  identities: readonly HouseholdContextActorIdentity[];
}): string {
  if (input.userId === input.viewerUserId) return "you";
  const identity = input.identities.find((candidate) => candidate.userId === input.userId);
  if (!identity) return "someone who's left";
  return identity.isActiveMember ? identity.name : `${identity.name} · former member`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A quiet, bounded "when".
 *
 * It stops at a week and hands over to a date, because past that point the
 * elapsed count stops being the useful fact and starts being arithmetic the
 * reader has to do. `now` is a parameter so the sentence is a pure function of
 * the data — the same fact renders the same way on the server and the client.
 */
export function householdContextRelativeTime(at: Date, now: Date): string {
  const elapsed = now.getTime() - at.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(at);
}

/**
 * The quiet attribution line: who last touched this, and when.
 *
 * One line, never a list of revisions. "Added by" and "Updated by" are told
 * apart by whether the same person created it and has not changed it since,
 * which is the only distinction a reader correcting a fact actually needs — the
 * rest would be an activity feed, which this page is explicitly not.
 */
export function householdContextAttributionLine(input: {
  fact: Pick<ContextFactView, "createdAt" | "updatedAt" | "actorAttribution">;
  viewerUserId: string;
  identities: readonly HouseholdContextActorIdentity[];
  now: Date;
}): string | null {
  const attribution = input.fact.actorAttribution;
  if (!attribution) return null;

  const untouched =
    attribution.creatorUserId === attribution.lastActorUserId &&
    input.fact.updatedAt.getTime() === input.fact.createdAt.getTime();
  const actorUserId = untouched ? attribution.creatorUserId : attribution.lastActorUserId;
  const actor = householdContextActorLabel({
    userId: actorUserId,
    viewerUserId: input.viewerUserId,
    identities: input.identities,
  });
  const when = householdContextRelativeTime(input.fact.updatedAt, input.now);

  return `${untouched ? "Added by" : "Updated by"} ${actor} · ${when}`;
}

export type HouseholdContextDraft = {
  category: ContextFactCategory;
  content: string;
  sensitivity: Sensitivity;
};

/** The authoritative statement as it stands now, for the reader to compare against. */
export type HouseholdContextCurrentState = {
  contextFactId: string;
  category: ContextFactCategory;
  content: string;
  sensitivity: Sensitivity;
  lifecycle: ContextFactView["lifecycle"];
  updatedAt: Date;
  lastActorUserId: string;
};

/**
 * What the member may do about a collision, in the order the surface offers them.
 *
 * `replace` is last and is the only one that needs a second press. Ordering the
 * two non-destructive choices first is the whole product position: the default
 * response to "somebody else got here first" is to read what they wrote, not to
 * win.
 */
export type HouseholdContextReconcileChoice = "keep_current" | "revise" | "replace";

export type HouseholdContextReconciliation = {
  /** The member's own unsaved wording. Never discarded by a stale write. */
  draft: HouseholdContextDraft;
  current: HouseholdContextCurrentState;
  choices: readonly HouseholdContextReconcileChoice[];
  /** Whether the draft and the current statement actually differ in substance. */
  draftDiffers: boolean;
};

/**
 * Builds the answer to a stale explicit edit.
 *
 * `replace` is withheld when the current fact is archived, because there is no
 * longer a current statement to replace — somebody removed it from what everyone
 * sees, and quietly resurrecting it under a new wording would hide that. Restore
 * is a separate, deliberate press.
 */
export function buildHouseholdContextReconciliation(input: {
  draft: HouseholdContextDraft;
  current: HouseholdContextCurrentState;
}): HouseholdContextReconciliation {
  const draftDiffers =
    input.draft.content.trim() !== input.current.content.trim() ||
    input.draft.category !== input.current.category ||
    input.draft.sensitivity !== input.current.sensitivity;

  const choices: HouseholdContextReconcileChoice[] =
    input.current.lifecycle === "archived"
      ? ["keep_current", "revise"]
      : ["keep_current", "revise", "replace"];

  return { draft: input.draft, current: input.current, choices, draftDiffers };
}

/**
 * The heading the reconcile panel wears.
 *
 * It states what happened and assigns no fault in either direction — the other
 * member did nothing wrong by correcting a shared fact, and neither did this one
 * by having the page open. Naming the actor rather than "another member" is what
 * makes the next decision easy to make.
 */
export function householdContextReconcileHeading(input: {
  reconciliation: HouseholdContextReconciliation;
  viewerUserId: string;
  identities: readonly HouseholdContextActorIdentity[];
}): string {
  const actor = householdContextActorLabel({
    userId: input.reconciliation.current.lastActorUserId,
    viewerUserId: input.viewerUserId,
    identities: input.identities,
  });
  if (input.reconciliation.current.lifecycle === "archived") {
    return `${actor === "you" ? "You" : actor} archived this while you were writing`;
  }
  return `${actor === "you" ? "You" : actor} changed this while you were writing`;
}

export const HOUSEHOLD_CONTEXT_RECONCILE_BODY =
  "Your wording is still here, nothing was lost, and nothing was overwritten. Have a look at what's there now and pick how to go on.";

export const householdContextReconcileChoiceCopy: Record<
  HouseholdContextReconcileChoice,
  { label: string; hint: string }
> = {
  keep_current: {
    label: "Keep theirs",
    hint: "Drop your version and leave the current statement as it is.",
  },
  revise: {
    label: "Revise mine",
    hint: "Go back to your draft with the current statement in view.",
  },
  replace: {
    label: "Replace with mine",
    hint: "Put your wording in place of theirs. They'll see the change the next time they look.",
  },
};

export type HouseholdContextGroup = {
  category: HouseholdContextCategory;
  label: string;
  facts: ContextFactView[];
};

export type HouseholdContextBoard = {
  groups: HouseholdContextGroup[];
  archived: ContextFactView[];
  /**
   * The small useful subset the Overview shows under "What everyone should
   * know". A subset, never a count of what is missing.
   */
  summary: ContextFactView[];
  activeCount: number;
};

function isHouseholdFact(fact: ContextFactView): boolean {
  return fact.subject.kind === "household";
}

/**
 * Arranges one household's facts for reading.
 *
 * Restricted facts are kept: this is the direct, deliberate management surface
 * for a caller the proof has already authorized, which is the one place they are
 * supposed to be legible. Excluding them from *automatic* orientation is a
 * different decision and lives with orientation.
 */
export function buildHouseholdContextBoard(input: {
  facts: readonly ContextFactView[];
  summaryLimit?: number;
}): HouseholdContextBoard {
  const household = input.facts.filter(isHouseholdFact);
  const active = household.filter((fact) => fact.lifecycle === "active");
  const archived = household
    .filter((fact) => fact.lifecycle === "archived")
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

  const groups = householdContextCategories.flatMap<HouseholdContextGroup>((category) => {
    const facts = active
      .filter((fact) => fact.category === category)
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
      );
    return facts.length === 0
      ? []
      : [{ category, label: contextFactCategoryLabel(category), facts }];
  });

  return {
    groups,
    archived,
    // Category order rather than recency, so the Overview's few lines read as an
    // orientation and not as the tail of an edit log.
    summary: groups.flatMap((group) => group.facts).slice(0, input.summaryLimit ?? 3),
    activeCount: active.length,
  };
}

const nonEmptyIdentifier = z.string().trim().min(1);
const householdContextContentSchema = z
  .string()
  .trim()
  .min(1, "Write one short thing everyone should know.")
  .max(500, "Keep it to 500 characters or fewer.")
  .superRefine((content, ctx) => {
    if (isPreciseAddressContextFactContent(content) || isRestrictedContextFactDisclosure(content)) {
      ctx.addIssue({
        code: "custom",
        message:
          "A precise address or a raw secret doesn't belong in shared context. Keep it in a Saved Item instead.",
      });
    }
  });

const householdContextCategorySchema = contextFactCategorySchema.extract([
  ...householdContextCategories,
]);

/**
 * Every household write carries the version its author was looking at.
 *
 * Required rather than optional, unlike the Self Context equivalent, because a
 * private fact has one author and a shared one does not: an unfenced write here
 * is precisely the silent last-write-wins this domain refuses (household context
 * management and correction).
 */
const householdContextFence = {
  callerUserId: nonEmptyIdentifier,
  contextFactId: nonEmptyIdentifier.max(128),
  expectedUpdatedAt: z.date(),
};

export const createHouseholdContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    category: householdContextCategorySchema,
    content: householdContextContentSchema,
    sensitivity: sensitivitySchema.default("normal"),
    provenance: contextFactProvenanceSchema.default({
      channel: "account",
      origin: "direct",
      sourceRecordId: null,
    }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.provenance.origin !== "direct") {
      ctx.addIssue({
        code: "custom",
        path: ["provenance", "origin"],
        message: "Direct Household Context writes require direct provenance.",
      });
    }
  });

export const updateHouseholdContextFactInputSchema = z
  .object({
    ...householdContextFence,
    category: householdContextCategorySchema,
    content: householdContextContentSchema,
    sensitivity: sensitivitySchema,
  })
  .strict();

export const archiveHouseholdContextFactInputSchema = z.object(householdContextFence).strict();
export const restoreHouseholdContextFactInputSchema = z.object(householdContextFence).strict();

export type CreateHouseholdContextFactInput = z.input<typeof createHouseholdContextFactInputSchema>;
export type UpdateHouseholdContextFactInput = z.input<typeof updateHouseholdContextFactInputSchema>;
export type ArchiveHouseholdContextFactInput = z.input<
  typeof archiveHouseholdContextFactInputSchema
>;
export type RestoreHouseholdContextFactInput = z.input<
  typeof restoreHouseholdContextFactInputSchema
>;

export const HOUSEHOLD_CONTEXT_EMPTY_TITLE = "Nothing here yet.";
export const HOUSEHOLD_CONTEXT_EMPTY_DESCRIPTION =
  "Add one thing that would genuinely help everyone here — roughly where you live, or a preference the household keeps coming back to. One is enough to start.";

/**
 * The Overview's pointer to the focused page.
 *
 * It describes the page rather than asking for work, because the section it sits
 * in is an orientation, not a setup task with a completion state.
 */
export const HOUSEHOLD_CONTEXT_SECTION_TITLE = "What everyone should know";
export const HOUSEHOLD_CONTEXT_SECTION_DESCRIPTION =
  "A few current facts everyone here can read and correct. Anything you don't put here stays yours.";
