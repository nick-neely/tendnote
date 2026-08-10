import type { TodayCandidate } from "@tendnote/domain";
import type { TodayCandidateLoaderDeps } from "../candidate-loaders";
import type { TodayCandidateLoader } from "../types";
import { DAY_MS, formatDateInZone, sourceSensitivity } from "./shared";

const RESURFACE_AGE_DAYS = 30;

export async function loadSavedItemCandidates(
  deps: TodayCandidateLoaderDeps,
  input: Parameters<TodayCandidateLoader>[0],
): Promise<TodayCandidate[]> {
  const items = await deps.listSavedItems({
    callerUserId: input.ownerUserId,
    includeArchived: false,
    limit: 40,
  });
  const candidates = await Promise.all(
    items.map(async (item): Promise<TodayCandidate | null> => {
      if (item.status !== "active") return null;
      // Private Today stays individually relevant rather than becoming a second
      // Household queue. A household-native item belongs to the workspace and to
      // nobody in particular, so it composes into Household and reaches a
      // member's own Today only through a Reminder Schedule that member chose.
      // Until then it sits there and nags nobody
      // (`docs/phase-8/household-saved-items.md`).
      if (item.ownership === "household_native") return null;
      const arrived =
        item.bringBackAt !== null && item.bringBackAt.getTime() <= input.now.getTime();
      const aged =
        item.bringBackAt === null &&
        input.now.getTime() - item.createdAt.getTime() >= RESURFACE_AGE_DAYS * DAY_MS;
      if (!arrived && !aged) return null;
      const sensitivity = await sourceSensitivity(deps, input.ownerUserId, item.sourceRecordId);
      if (sensitivity === "restricted") return null;
      return {
        identity: `saved_item:${item.id}`,
        family: "saved_item",
        record: { kind: "saved_item", id: item.id, href: `/saved-items#saved-item-${item.id}` },
        title: item.title,
        context:
          item.kind === "open_question"
            ? "Open question"
            : item.kind === "link"
              ? "Saved link"
              : "Saved note",
        reason: arrived
          ? {
              code: "bring_back_arrived",
              key: `bring-back:${item.bringBackAt?.toISOString()}`,
              explanation: `Set to return ${formatDateInZone(item.bringBackAt as Date, input.timeZone)}.`,
            }
          : {
              code: "aged_after_cooldown",
              key: `aged:${item.createdAt.toISOString()}`,
              explanation: `Saved ${formatDateInZone(item.createdAt, input.timeZone)} and eligible after its cooldown.`,
            },
        sourceRefs: [
          { kind: "saved_item", id: item.id },
          { kind: "source_record", id: item.sourceRecordId },
        ],
        action: {
          kind: "open_record",
          label: "Open",
          href: `/saved-items#saved-item-${item.id}`,
        },
        mandatory: false,
        dueAt: item.bringBackAt,
        createdAt: item.createdAt,
        sensitivity,
      };
    }),
  );
  return candidates.filter((candidate): candidate is TodayCandidate => candidate !== null);
}
