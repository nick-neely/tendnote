import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmittedOwnerForAction, searchGlobalRecall } = vi.hoisted(() => ({
  searchGlobalRecall: vi.fn(),
  requireAdmittedOwnerForAction: vi.fn(),
}));

vi.mock("@tendnote/db/queries/global-recall", () => ({ searchGlobalRecall }));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwnerForAction }));

import { globalRecallAction } from "./global-recall";

describe("globalRecallAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmittedOwnerForAction.mockResolvedValue("owner-1");
    searchGlobalRecall.mockResolvedValue({
      query: "filter",
      results: [],
      limitations: [],
      hasMore: false,
    });
  });

  it("derives the admitted owner and delegates validated input to the shared seam", async () => {
    await expect(globalRecallAction({ query: " filter " })).resolves.toMatchObject({
      query: "filter",
    });
    expect(searchGlobalRecall).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      query: "filter",
      family: "all",
      includeArchived: false,
      includeRestricted: false,
      offset: 0,
      limit: 12,
    });
  });
});
