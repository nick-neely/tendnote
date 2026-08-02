import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePathSpy, updateTagSpy } from "@/test/action-adapter-mocks";

const { createSelfContextFact, updateSelfContextFact } = vi.hoisted(() => ({
  createSelfContextFact: vi.fn(),
  updateSelfContextFact: vi.fn(),
}));

vi.mock("@tendnote/db/queries/context-facts", () => ({
  createSelfContextFact,
  updateSelfContextFact,
}));

import { createSelfContextFactAction, updateSelfContextFactAction } from "./context-facts";

const FACT_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-02T12:00:00.000Z");
const FACT_VIEW = {
  id: FACT_ID,
  subject: { kind: "self", userId: "owner-1" },
  category: "work",
  content: "I run a software consultancy.",
  lifecycle: "active",
  sensitivity: "normal",
  provenance: { channel: "account", origin: "direct", sourceRecordId: null },
  suggestionEvidence: null,
  creatorUserId: "owner-1",
  lastActorUserId: "owner-1",
  reviewedAt: NOW,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  trust: "untrusted_data",
  authority: "none",
  visibility: "private",
} as const;
const AFFECTED_SCOPES = [
  { kind: "owner-collection", collection: "context-facts", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "orientation", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "global-recall", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  createSelfContextFact.mockResolvedValue({ result: FACT_VIEW, affectedScopes: AFFECTED_SCOPES });
  updateSelfContextFact.mockResolvedValue({ result: FACT_VIEW, affectedScopes: AFFECTED_SCOPES });
});

describe("Self Context server actions", () => {
  it("derives the private subject from the admitted owner and reconciles every returned scope", async () => {
    await expect(
      createSelfContextFactAction({
        category: "work",
        content: " I run a software consultancy. ",
        sensitivity: "normal",
      }),
    ).resolves.toEqual({ ok: true, view: FACT_VIEW });

    expect(createSelfContextFact).toHaveBeenCalledWith(
      {
        callerUserId: "owner-1",
        category: "work",
        content: "I run a software consultancy.",
        sensitivity: "normal",
      },
      expect.any(Function),
    );
    expect(updateTagSpy).toHaveBeenCalledWith("context-facts:owner:owner-1");
    expect(updateTagSpy).toHaveBeenCalledWith("orientation:owner:owner-1");
    expect(updateTagSpy).toHaveBeenCalledWith("global-recall:owner:owner-1");
    expect(updateTagSpy).toHaveBeenCalledWith("account:owner:owner-1");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/account");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/account/about-you");
  });

  it("updates only the submitted fields and never accepts a client owner or subject", async () => {
    await expect(
      updateSelfContextFactAction({
        contextFactId: FACT_ID,
        category: "preference",
        content: "I prefer concise answers.",
        sensitivity: "sensitive",
      }),
    ).resolves.toEqual({ ok: true, view: FACT_VIEW });

    expect(updateSelfContextFact).toHaveBeenCalledWith(
      {
        callerUserId: "owner-1",
        contextFactId: FACT_ID,
        category: "preference",
        content: "I prefer concise answers.",
        sensitivity: "sensitive",
      },
      expect.any(Function),
    );

    await expect(
      createSelfContextFactAction({
        category: "work",
        content: "I run a consultancy.",
        ownerUserId: "other-owner",
      } as never),
    ).resolves.toMatchObject({ ok: false });
    expect(createSelfContextFact).not.toHaveBeenCalled();
  });

  it("returns input validation as data before calling the shared mutation", async () => {
    await expect(
      createSelfContextFactAction({ category: "work", content: " " }),
    ).resolves.toMatchObject({ ok: false, error: expect.any(String) });
    expect(createSelfContextFact).not.toHaveBeenCalled();
  });
});
