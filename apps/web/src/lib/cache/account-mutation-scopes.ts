import { revalidatePath } from "next/cache";

export type AccountMutationScope = { kind: "account-owner"; ownerUserId: string };

/** Provider state is request-bound; this scope gives its direct writes one RYW contract. */
export const accountMutationScopes = {
  forOwner(ownerUserId: string): AccountMutationScope[] {
    return [{ kind: "account-owner", ownerUserId }];
  },
};

/**
 * Direct owner writes revalidate the request-bound Account projections before
 * returning. These provider reads deliberately do not opt into a shared cache,
 * so a path scope is the honest RYW boundary (rather than an unused cache tag).
 */
export function updateAccountMutationScopes(scopes: AccountMutationScope[]) {
  if (scopes.length === 0) return;
  revalidatePath("/account");
  revalidatePath("/account/contacts/import");
  revalidatePath("/account/discord");
}
