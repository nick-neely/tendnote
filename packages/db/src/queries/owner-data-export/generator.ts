import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { accessProfiles, user } from "../../schema";
import { buildOwnerDataExportArchive } from "./archive";
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
}) {
  const account = await loadOwnerDataExportAccount(input.ownerUserId);
  if (!account) {
    throw new Error("Owner account is unavailable for export.");
  }
  return buildOwnerDataExportArchive({ account, now: input.now, expiresAt: input.expiresAt });
}
