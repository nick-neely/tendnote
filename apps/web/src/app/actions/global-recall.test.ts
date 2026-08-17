import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceProductBudgetSpy,
  requireAdmittedOwnerForActionSpy,
} from "@/test/action-adapter-mocks";

const { searchGlobalRecall } = vi.hoisted(() => ({
  searchGlobalRecall: vi.fn(),
}));

vi.mock("@tendnote/db/queries/global-recall", () => ({ searchGlobalRecall }));

import { globalRecallAction } from "./global-recall";

describe("globalRecallAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
    searchGlobalRecall.mockResolvedValue({
      query: "filter",
      results: [],
      limitations: [],
      hasMore: false,
    });
  });

  it("derives the admitted owner and delegates validated input to the shared seam", async () => {
    await expect(globalRecallAction({ query: " filter " })).resolves.toMatchObject({
      ok: true,
      view: { query: "filter" },
    });
    expect(searchGlobalRecall).toHaveBeenCalledWith(
      {
        ownerUserId: "owner-1",
        query: "filter",
        family: "all",
        includeArchived: false,
        includeRestricted: false,
        offset: 0,
        limit: 12,
      },
      { readerFor: expect.any(Function) },
    );
    expect(enforceProductBudgetSpy).toHaveBeenCalledWith({
      subject: "owner-1",
      costCategory: "embedding",
    });
  });
});
