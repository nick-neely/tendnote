import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requireAdmittedOwnerForActionSpy,
  revalidatePathSpy,
  updateTagSpy,
} from "@/test/action-adapter-mocks";

const { completeSelfContextOnboarding, createSelfContextFact, dismissSelfContextOnboarding } =
  vi.hoisted(() => ({
    completeSelfContextOnboarding: vi.fn(),
    createSelfContextFact: vi.fn(),
    dismissSelfContextOnboarding: vi.fn(),
  }));

vi.mock("@tendnote/db/queries/access-profiles", () => ({
  completeSelfContextOnboarding,
  dismissSelfContextOnboarding,
}));
vi.mock("@tendnote/db/queries/context-facts", () => ({ createSelfContextFact }));

import {
  completeSelfContextOnboardingAction,
  createOnboardingSelfContextFactAction,
  dismissSelfContextOnboardingAction,
} from "./context-onboarding";

const STATE = { status: "completed" as const, reminderAt: null };
const FACT = {
  id: "00000000-0000-4000-8000-000000000001",
  subject: { kind: "self" as const },
  category: "work" as const,
  content: "I run a software consultancy.",
  lifecycle: "active" as const,
  sensitivity: "normal" as const,
  provenance: { channel: "onboarding" as const, origin: "direct" as const },
  reviewedAt: new Date("2026-08-02T12:00:00.000Z"),
  archivedAt: null,
  createdAt: new Date("2026-08-02T12:00:00.000Z"),
  updatedAt: new Date("2026-08-02T12:00:00.000Z"),
  trust: "untrusted_data" as const,
  authority: "none" as const,
  visibility: "private" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  completeSelfContextOnboarding.mockResolvedValue(STATE);
  dismissSelfContextOnboarding.mockResolvedValue({ status: "dismissed", reminderAt: null });
  createSelfContextFact.mockResolvedValue({
    result: FACT,
    decision: "created",
    affectedScopes: [
      { kind: "owner-collection", collection: "context-facts", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "orientation", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
    ],
  });
});

describe("Self Context onboarding server actions", () => {
  it("creates direct onboarding facts through the shared mutation with onboarding provenance", async () => {
    await expect(
      createOnboardingSelfContextFactAction({
        category: "work",
        content: " I run a software consultancy. ",
        sensitivity: "normal",
      }),
    ).resolves.toMatchObject({ ok: true, view: { fact: FACT } });

    expect(createSelfContextFact).toHaveBeenCalledWith(
      {
        callerUserId: "owner-1",
        category: "work",
        content: "I run a software consultancy.",
        sensitivity: "normal",
        provenance: { channel: "onboarding", origin: "direct", sourceRecordId: null },
      },
      expect.any(Function),
    );
    expect(updateTagSpy).toHaveBeenCalledWith("context-facts:owner:owner-1");
  });

  it("completes and dismisses setup only for the admitted owner and invalidates account/home state", async () => {
    await expect(completeSelfContextOnboardingAction()).resolves.toEqual({
      ok: true,
      view: STATE,
    });
    expect(completeSelfContextOnboarding).toHaveBeenCalledWith({ userId: "owner-1" });
    expect(updateTagSpy).toHaveBeenCalledWith("account:owner:owner-1");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/");

    await expect(dismissSelfContextOnboardingAction()).resolves.toEqual({
      ok: true,
      view: { status: "dismissed", reminderAt: null },
    });
    expect(dismissSelfContextOnboarding).toHaveBeenCalledWith({ userId: "owner-1" });
  });

  it("derives onboarding facts independently for two admitted owners", async () => {
    requireAdmittedOwnerForActionSpy
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-2");

    await createOnboardingSelfContextFactAction({
      category: "work",
      content: "Owner one work context",
      sensitivity: "normal",
    });
    await createOnboardingSelfContextFactAction({
      category: "interest",
      content: "Owner two interest context",
      sensitivity: "sensitive",
    });

    expect(createSelfContextFact).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        callerUserId: "owner-1",
        provenance: { channel: "onboarding", origin: "direct", sourceRecordId: null },
      }),
      expect.any(Function),
    );
    expect(createSelfContextFact).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        callerUserId: "owner-2",
        provenance: { channel: "onboarding", origin: "direct", sourceRecordId: null },
      }),
      expect.any(Function),
    );
  });
});
