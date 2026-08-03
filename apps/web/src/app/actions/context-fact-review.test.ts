import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePathSpy, updateTagSpy } from "@/test/action-adapter-mocks";

const { acceptSuggestedContextFact, dismissSuggestedContextFact } = vi.hoisted(() => ({
  acceptSuggestedContextFact: vi.fn(),
  dismissSuggestedContextFact: vi.fn(),
}));

vi.mock("@tendnote/db/queries/context-facts", () => ({
  acceptSuggestedContextFact,
  dismissSuggestedContextFact,
}));

import {
  acceptSuggestedContextFactAction,
  dismissSuggestedContextFactAction,
} from "./context-fact-review";

const FACT_ID = "00000000-0000-4000-8000-000000000021";
const NOW = new Date("2026-08-02T12:00:00.000Z");
const FACT_VIEW = {
  id: FACT_ID,
  subject: { kind: "self" },
  category: "work",
  content: "I run a software consultancy.",
  lifecycle: "active",
  sensitivity: "sensitive",
  provenance: { channel: "ambient", origin: "ambient" },
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
  acceptSuggestedContextFact.mockResolvedValue({
    result: FACT_VIEW,
    decision: "accepted",
    affectedScopes: AFFECTED_SCOPES,
  });
  dismissSuggestedContextFact.mockResolvedValue({
    result: { dismissedContextFactId: FACT_ID },
    affectedScopes: AFFECTED_SCOPES,
  });
});

describe("Suggested Context Fact server actions", () => {
  it("derives the owner, forwards an optional reviewed edit, and reconciles every affected scope", async () => {
    await expect(
      acceptSuggestedContextFactAction({
        contextFactId: FACT_ID,
        expectedUpdatedAt: NOW.toISOString(),
        edit: {
          category: "preference",
          content: "I prefer concise answers.",
          sensitivity: "restricted",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      view: { fact: FACT_VIEW, decision: "accepted" },
    });

    expect(acceptSuggestedContextFact).toHaveBeenCalledWith(
      {
        callerUserId: "owner-1",
        contextFactId: FACT_ID,
        expectedUpdatedAt: NOW,
        edit: {
          category: "preference",
          content: "I prefer concise answers.",
          sensitivity: "restricted",
        },
      },
      expect.any(Function),
    );
    expect(updateTagSpy).toHaveBeenCalledWith("context-facts:owner:owner-1");
    expect(updateTagSpy).toHaveBeenCalledWith("orientation:owner:owner-1");
    expect(updateTagSpy).toHaveBeenCalledWith("review:owner:owner-1");
    expect(updateTagSpy).toHaveBeenCalledWith("global-recall:owner:owner-1");
    expect(updateTagSpy).toHaveBeenCalledWith("account:owner:owner-1");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/account/about-you");
  });

  it("dismisses only the owner-scoped suggestion and returns the bounded tombstone", async () => {
    await expect(
      dismissSuggestedContextFactAction({
        contextFactId: FACT_ID,
        expectedUpdatedAt: NOW.toISOString(),
      }),
    ).resolves.toEqual({
      ok: true,
      view: { dismissedContextFactId: FACT_ID },
    });

    expect(dismissSuggestedContextFact).toHaveBeenCalledWith(
      { callerUserId: "owner-1", contextFactId: FACT_ID, expectedUpdatedAt: NOW },
      expect.any(Function),
    );
    expect(updateTagSpy).toHaveBeenCalledWith("review:owner:owner-1");
    expect(updateTagSpy).toHaveBeenCalledWith("account:owner:owner-1");
  });

  it("returns validation failures before calling the shared review mutation", async () => {
    await expect(
      acceptSuggestedContextFactAction({ contextFactId: "not-a-uuid" }),
    ).resolves.toMatchObject({ ok: false, error: expect.any(String) });
    expect(acceptSuggestedContextFact).not.toHaveBeenCalled();
  });
});
