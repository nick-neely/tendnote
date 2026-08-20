import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { accessProfiles, user } from "../../schema";
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
  return buildOwnerDataExportArchive({
    account,
    now: input.now,
    expiresAt: input.expiresAt,
    additionalEntries: extension.entries,
    additionalResources: extension.resources,
    additionalFamilies: extension.families,
  });
}
