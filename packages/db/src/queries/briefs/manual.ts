import type { BriefCadence, BriefWithItems } from "@tendnote/domain";
import type { CalendarReaderForOwner } from "../calendar";
import {
  type BriefAgendaSource,
  type BriefGeneratorOptions,
  createBriefGenerator,
} from "./generator";
import type { BriefLifecycleStore } from "./types";

export type ManualBriefOutcome = "created" | "returned_existing" | "regenerated";

export type ManualBriefInput = {
  ownerUserId: string;
  cadence: BriefCadence;
  localDate: string;
  // Explicit regeneration supersedes and replaces the current brief; otherwise the
  // existing current brief is returned unchanged.
  regenerate?: boolean;
  now?: Date;
  /** Runtime-owned Calendar reader composition for live cache misses. */
  calendarReaderFor?: CalendarReaderForOwner;
};

export type ManualBriefResult = {
  brief: BriefWithItems;
  outcome: ManualBriefOutcome;
};

/**
 * Narrow owner-scoped manual generate/regenerate path for the current daily and
 * weekly briefs (PRD #65, issue #69). It exists for local testing and recovery
 * without production cron, and it calls the exact same shared generator schedule
 * dispatch uses (built here from the same store), so business rules cannot fork.
 *
 * By default it returns the existing current brief; regeneration is explicit and
 * supersedes the prior artifact, respecting prior dismiss/snooze feedback via the
 * generator. Every manual generate/regenerate is audited so user-triggered changes
 * to generated artifacts stay explainable.
 */
export function createManualBriefGeneration(
  store: BriefLifecycleStore,
  agenda: BriefAgendaSource,
  options: BriefGeneratorOptions = {},
) {
  const generator = createBriefGenerator(store, agenda, options);

  return {
    async generateCurrentBrief(input: ManualBriefInput): Promise<ManualBriefResult> {
      const existing = await store.findCurrentBrief({
        ownerUserId: input.ownerUserId,
        localDate: input.localDate,
        cadence: input.cadence,
      });

      // Default behavior is return-existing: a manual request does not silently
      // replace a brief the user may already be reviewing (PRD #65). A no-op read
      // is not a change, so it is not audited.
      if (existing && !input.regenerate) {
        return { brief: existing, outcome: "returned_existing" };
      }

      // Regeneration only supersedes when there is a current brief to replace; a
      // first-time manual generate is a "create" even if regenerate was requested,
      // so provenance is never labeled "regenerated" without a superseded predecessor.
      const regenerating = existing !== null && (input.regenerate ?? false);

      const brief = await generator.generateBrief({
        ownerUserId: input.ownerUserId,
        cadence: input.cadence,
        localDate: input.localDate,
        regenerate: regenerating,
        generationReason: regenerating ? "regenerated" : "manual",
        now: input.now,
        calendarReaderFor: input.calendarReaderFor,
      });

      const outcome: ManualBriefOutcome = regenerating ? "regenerated" : "created";
      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: regenerating ? "brief.regenerate" : "brief.generate",
        entityType: "brief",
        entityId: brief.id,
        metadataJson: {
          cadence: input.cadence,
          localDate: input.localDate,
          outcome,
          // Link the superseded predecessor so the regeneration is fully explainable.
          ...(regenerating && existing ? { supersededBriefId: existing.id } : {}),
        },
      });

      return { brief, outcome };
    },
  };
}
