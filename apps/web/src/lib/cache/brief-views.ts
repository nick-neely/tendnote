import { getCurrentBrief } from "@tendnote/db/queries/briefs";
import type { BriefCadence } from "@tendnote/domain";
import { cacheLife, cacheTag } from "next/cache";
import { toBriefView } from "@/lib/brief-view";
import { tagsForAffectedScope } from "./affected-scope-tags";
import { cacheProfiles } from "./cache-profiles";

/** The persisted owner Brief snapshot for one cadence and local date. */
export async function getCachedCurrentBriefView(input: {
  ownerUserId: string;
  cadence: BriefCadence;
  localDate: string;
}) {
  return cachedCurrentBriefView(input.ownerUserId, input.cadence, input.localDate);
}

async function cachedCurrentBriefView(
  ownerUserId: string,
  cadence: BriefCadence,
  localDate: string,
) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(
    ...tagsForAffectedScope({
      kind: "owner-collection",
      collection: "briefs",
      ownerUserId,
    }),
  );
  const brief = await getCurrentBrief({ ownerUserId, cadence, localDate });
  return brief ? toBriefView(brief) : null;
}
