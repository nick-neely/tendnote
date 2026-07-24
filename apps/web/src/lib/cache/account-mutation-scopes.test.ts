import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));

import { accountMutationScopes, updateAccountMutationScopes } from "./account-mutation-scopes";

describe("Account mutation scopes", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
  });

  it("revalidates the request-bound Account projections for a direct owner write", () => {
    updateAccountMutationScopes(accountMutationScopes.forOwner("owner-a"));

    expect(revalidatePath).toHaveBeenCalledWith("/account");
    expect(revalidatePath).toHaveBeenCalledWith("/account/contacts/import");
    expect(revalidatePath).toHaveBeenCalledWith("/account/discord");
  });
});
