import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { accessProfiles, user } from "../../schema";
import type {
  OwnerDataExportActionsPlanningContext,
  OwnerDataExportActionsPlanningContextLoader,
} from "./actions-planning";
import {
  loadOwnerDataExportActionsPlanningContext,
  ownerDataExportActionsPlanningContextExtension,
} from "./actions-planning";
import { buildOwnerDataExportArchive } from "./archive";
import type {
  OwnerDataExportRelationshipContext,
  OwnerDataExportRelationshipContextLoader,
} from "./relationship-context";
import {
  loadOwnerDataExportRelationshipContext,
  ownerDataExportRelationshipContextExtension,
} from "./relationship-context";
import type { OwnerDataExportAccount } from "./types";

export async function loadOwnerDataExportAccount(
  ownerUserId: string,
): Promise<OwnerDataExportAccount | null> {
  const [record] = await getDb()
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      accessStatus: accessProfiles.status,
      accessSource: accessProfiles.source,
      grantedAt: accessProfiles.grantedAt,
    })
    .from(user)
    .leftJoin(accessProfiles, eq(accessProfiles.userId, user.id))
    .where(and(eq(user.id, ownerUserId)))
    .limit(1);
  return record ?? null;
}

export async function generateOwnerDataExportArchive(input: {
  ownerUserId: string;
  now: Date;
  expiresAt: Date;
  account?: OwnerDataExportAccount;
  /** Test and future adapter seam; production uses the owner-scoped Drizzle loader. */
  relationshipContext?: OwnerDataExportRelationshipContext;
  loadRelationshipContext?: OwnerDataExportRelationshipContextLoader;
  /** Test and future adapter seam for the action/planning resource family. */
  actionsPlanningContext?: OwnerDataExportActionsPlanningContext;
  loadActionsPlanningContext?: OwnerDataExportActionsPlanningContextLoader;
}) {
  const account = input.account ?? (await loadOwnerDataExportAccount(input.ownerUserId));
  if (!account) {
    throw new Error("Owner account is unavailable for export.");
  }
  if (account.id !== input.ownerUserId) {
    throw new Error("Owner account does not match the export owner.");
  }
  const relationshipContext =
    input.relationshipContext ??
    (await (input.loadRelationshipContext ?? loadOwnerDataExportRelationshipContext)({
      ownerUserId: input.ownerUserId,
    }));
  const extension = ownerDataExportRelationshipContextExtension(
    input.ownerUserId,
    relationshipContext,
  );
  // Existing relationship-context adapters remain useful in isolation (and in
  // the #478 generated-ZIP tests), so an explicitly supplied relationship graph
  // does not unexpectedly perform a second production database load. Production
  // generation has neither fixture context and therefore gets the full loader.
  const actionsPlanningExtension =
    input.actionsPlanningContext ||
    input.loadActionsPlanningContext ||
    (!input.relationshipContext && !input.loadRelationshipContext)
      ? ownerDataExportActionsPlanningContextExtension(
          input.ownerUserId,
          input.actionsPlanningContext ??
            (input.loadActionsPlanningContext
              ? await input.loadActionsPlanningContext({ ownerUserId: input.ownerUserId })
              : await loadOwnerDataExportActionsPlanningContext({
                  ownerUserId: input.ownerUserId,
                })),
          {
            sourceRecordIds: relationshipContext.sourceRecords.map((record) => record.id),
            personIds: relationshipContext.people.map((person) => person.id),
            memoryIds: relationshipContext.memories.map((memory) => memory.id),
            followupIds: relationshipContext.followups.map((followup) => followup.id),
            sensitivityByRecordId: Object.fromEntries([
              ...relationshipContext.sourceRecords.map(
                (record) => [record.id, record.sensitivity] as const,
              ),
              ...relationshipContext.memories.map(
                (memory) => [memory.id, memory.sensitivity] as const,
              ),
            ]),
          },
        )
      : { entries: [], resources: [], families: [] };
  return buildOwnerDataExportArchive({
    account,
    now: input.now,
    expiresAt: input.expiresAt,
    additionalEntries: [...extension.entries, ...actionsPlanningExtension.entries],
    additionalResources: [...extension.resources, ...actionsPlanningExtension.resources],
    additionalFamilies: [...extension.families, ...actionsPlanningExtension.families],
  });
}
