import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePathSpy, updateTagSpy } from "@/test/action-adapter-mocks";

const {
  archiveSelfContextFact,
  createSelfContextFact,
  deleteSelfContextFact,
  restoreSelfContextFact,
  updateSelfContextFact,
} = vi.hoisted(() => ({
  archiveSelfContextFact: vi.fn(),
  createSelfContextFact: vi.fn(),
  deleteSelfContextFact: vi.fn(),
  restoreSelfContextFact: vi.fn(),
  updateSelfContextFact: vi.fn(),
}));

vi.mock("@tendnote/db/queries/context-facts", () => ({
  archiveSelfContextFact,
  createSelfContextFact,
  deleteSelfContextFact,
  restoreSelfContextFact,
  updateSelfContextFact,
}));

import {
  archiveSelfContextFactAction,
  createSelfContextFactAction,
  deleteSelfContextFactAction,
  restoreSelfContextFactAction,
  updateSelfContextFactAction,
} from "./context-facts";

const FACT_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-02T12:00:00.000Z");
const FACT_VIEW = {
  id: FACT_ID,
  subject: { kind: "self" },
  category: "work",
  content: "I run a software consultancy.",
  lifecycle: "active",
  sensitivity: "normal",
  provenance: { channel: "account", origin: "direct" },
  reviewedAt: NOW,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  trust: "untrusted_data",
  authority: "none",
  visibility: "private",
} as const;
const ARCHIVED_FACT_VIEW = {
  ...FACT_VIEW,
  lifecycle: "archived",
  archivedAt: new Date("2026-08-02T12:01:00.000Z"),
  updatedAt: new Date("2026-08-02T12:01:00.000Z"),
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
  createSelfContextFact.mockResolvedValue({
    result: FACT_VIEW,
    decision: "created",
    affectedScopes: AFFECTED_SCOPES,
  });
  updateSelfContextFact.mockResolvedValue({
    result: FACT_VIEW,
    decision: "updated",
    affectedScopes: AFFECTED_SCOPES,
  });
  archiveSelfContextFact.mockResolvedValue({
    result: ARCHIVED_FACT_VIEW,
    decision: "archived",
    affectedScopes: AFFECTED_SCOPES,
  });
  restoreSelfContextFact.mockResolvedValue({
    result: FACT_VIEW,
    decision: "restored",
    affectedScopes: AFFECTED_SCOPES,
  });
  deleteSelfContextFact.mockResolvedValue({
    result: { deletedContextFactId: FACT_ID },
    affectedScopes: AFFECTED_SCOPES,
  });
});

describe("Self Context server actions", () => {
  it("derives the private subject from the admitted owner and reconciles every returned scope", async () => {
    await expect(
      createSelfContextFactAction({
        category: "work",
        content: " I run a software consultancy. ",
        sensitivity: "normal",
      }),
    ).resolves.toEqual({
      ok: true,
      view: { fact: FACT_VIEW, decision: "created" },
    });

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
        expectedUpdatedAt: NOW.toISOString(),
        category: "preference",
        content: "I prefer concise answers.",
        sensitivity: "sensitive",
      }),
    ).resolves.toEqual({
      ok: true,
      view: { fact: FACT_VIEW, decision: "updated" },
    });

    expect(updateSelfContextFact).toHaveBeenCalledWith(
      {
        callerUserId: "owner-1",
        contextFactId: FACT_ID,
        expectedUpdatedAt: NOW,
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

  it("keeps lifecycle actions owner-scoped, timestamp-guarded, and cache-reconciled", async () => {
    await expect(
      archiveSelfContextFactAction({
        contextFactId: FACT_ID,
        expectedUpdatedAt: NOW.toISOString(),
      }),
    ).resolves.toEqual({
      ok: true,
      view: { fact: ARCHIVED_FACT_VIEW, decision: "archived" },
    });
    expect(archiveSelfContextFact).toHaveBeenCalledWith(
      {
        callerUserId: "owner-1",
        contextFactId: FACT_ID,
        expectedUpdatedAt: NOW,
      },
      expect.any(Function),
    );

    await expect(
      restoreSelfContextFactAction({
        contextFactId: FACT_ID,
        expectedArchivedAt: ARCHIVED_FACT_VIEW.archivedAt.toISOString(),
      }),
    ).resolves.toEqual({
      ok: true,
      view: { fact: FACT_VIEW, decision: "restored" },
    });
    expect(restoreSelfContextFact).toHaveBeenCalledWith(
      {
        callerUserId: "owner-1",
        contextFactId: FACT_ID,
        expectedArchivedAt: ARCHIVED_FACT_VIEW.archivedAt,
      },
      expect.any(Function),
    );

    await expect(deleteSelfContextFactAction({ contextFactId: FACT_ID })).resolves.toEqual({
      ok: true,
      view: { deletedContextFactId: FACT_ID },
    });
    expect(deleteSelfContextFact).toHaveBeenCalledWith(
      { callerUserId: "owner-1", contextFactId: FACT_ID },
      expect.any(Function),
    );
    expect(updateTagSpy).toHaveBeenCalledWith("global-recall:owner:owner-1");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/account/about-you");
  });
});
