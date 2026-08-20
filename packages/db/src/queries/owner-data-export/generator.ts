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

type GenerateOwnerDataExportArchiveInput = {
  ownerUserId: string;
  now: Date;
  expiresAt: Date;
  account?: OwnerDataExportAccount;
  relationshipContext?: OwnerDataExportRelationshipContext;
  loadRelationshipContext?: OwnerDataExportRelationshipContextLoader;
  actionsPlanningContext?: OwnerDataExportActionsPlanningContext;
  loadActionsPlanningContext?: OwnerDataExportActionsPlanningContextLoader;
};

async function resolveRelationshipContext(input: GenerateOwnerDataExportArchiveInput) {
  if (input.relationshipContext) return input.relationshipContext;
  const load = input.loadRelationshipContext ?? loadOwnerDataExportRelationshipContext;
  return load({ ownerUserId: input.ownerUserId });
}

function includesActionsPlanning(input: GenerateOwnerDataExportArchiveInput) {
  return Boolean(
    input.actionsPlanningContext ||
      input.loadActionsPlanningContext ||
      (!input.relationshipContext && !input.loadRelationshipContext),
  );
}

async function resolveActionsPlanningContext(input: GenerateOwnerDataExportArchiveInput) {
  if (input.actionsPlanningContext) return input.actionsPlanningContext;
  const load = input.loadActionsPlanningContext ?? loadOwnerDataExportActionsPlanningContext;
  return load({ ownerUserId: input.ownerUserId });
}

const EMPTY_EXTENSION = { entries: [], resources: [], families: [] };

export async function generateOwnerDataExportArchive(input: GenerateOwnerDataExportArchiveInput) {
  const account = input.account ?? (await loadOwnerDataExportAccount(input.ownerUserId));
  if (!account) {
    throw new Error("Owner account is unavailable for export.");
  }
  if (account.id !== input.ownerUserId) {
    throw new Error("Owner account does not match the export owner.");
  }
  const relationshipContext = await resolveRelationshipContext(input);
  const extension = ownerDataExportRelationshipContextExtension(
    input.ownerUserId,
    relationshipContext,
  );
  // Existing relationship-context adapters remain useful in isolation (and in
  // the #478 generated-ZIP tests), so an explicitly supplied relationship graph
  // does not unexpectedly perform a second production database load. Production
  // generation has neither fixture context and therefore gets the full loader.
  const actionsPlanningExtension = includesActionsPlanning(input)
    ? ownerDataExportActionsPlanningContextExtension(
        input.ownerUserId,
        await resolveActionsPlanningContext(input),
        extension.grounding,
      )
    : EMPTY_EXTENSION;
  return buildOwnerDataExportArchive({
    account,
    now: input.now,
    expiresAt: input.expiresAt,
    additionalEntries: [...extension.entries, ...actionsPlanningExtension.entries],
    additionalResources: [...extension.resources, ...actionsPlanningExtension.resources],
    additionalFamilies: [...extension.families, ...actionsPlanningExtension.families],
  });
}
