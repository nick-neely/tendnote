import type { TodayShortlistResponse } from "@tendnote/domain/today";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeFollowupAction,
  dismissFollowupAction,
  reopenFollowupAction,
  restoreArchivedFollowupAction,
} from "@/app/actions/followups";
import {
  archiveHouseholdSavedItemAction,
  archiveSavedItemAction,
  reopenSavedItemAction,
  restoreHouseholdSavedItemAction,
} from "@/app/actions/saved-items";
import { followupLifecycleAdapter } from "@/lib/followup-reversible-mutation";
import { savedItemLifecycleAdapter } from "@/lib/saved-item-reversible-mutation";
import {
  suggestedFollowupDismissAdapter,
  suggestedGeneralActionDismissAdapter,
  suggestedMemoryDismissAdapter,
} from "@/lib/suggestion-reversible-mutation";
import { todaySuppressionAdapter } from "@/lib/today-reversible-mutation";

vi.mock("@/app/actions/followups", () => ({
  archiveFollowupAction: vi.fn(),
  completeFollowupAction: vi.fn(),
  dismissFollowupAction: vi.fn(),
  reopenFollowupAction: vi.fn(),
  restoreArchivedFollowupAction: vi.fn(),
}));

vi.mock("@/app/actions/saved-items", () => ({
  archiveHouseholdSavedItemAction: vi.fn(),
  archiveSavedItemAction: vi.fn(),
  reopenSavedItemAction: vi.fn(),
  restoreHouseholdSavedItemAction: vi.fn(),
}));

const followup = {
  id: "11111111-1111-4111-8111-111111111111",
  revision: "1",
  reason: "Check in",
  status: "open" as const,
  ownerUserId: "owner",
  owned: true,
  dueAtISO: "2026-08-12T00:00:00.000Z",
  dueAtDate: "2026-08-12",
  dueLabel: "Aug 12",
  dueState: "upcoming" as const,
  surfaceLabel: "Aug 12",
  visibilityChoice: "only_me" as const,
  visibilityLabel: "Only you",
};

const savedItem = {
  id: "22222222-2222-4222-8222-222222222222",
  revision: "1",
  kind: "note" as const,
  kindLabel: "Note",
  title: "Keep this",
  content: null,
  url: null,
  status: "active" as const,
  archived: false,
  ownerUserId: "owner" as string | null,
  ownership: "member_owned" as const,
  version: 1,
  owned: true,
  canEdit: true,
  canDeleteEvidence: true,
  bringBackAt: null,
  bringBackState: null,
  bringBackLabel: null,
  scope: "private" as const,
  visibilityLabel: "Only you",
  createdByLabel: null,
  lastChangedByLabel: null,
  sourceRecordId: "33333333-3333-4333-8333-333333333333",
  resolutionReason: null,
  outcomes: [],
};

const householdSavedItem = {
  ...savedItem,
  ownerUserId: null,
  ownership: "household_native" as const,
  scope: "household" as const,
  visibilityLabel: "Household",
};

beforeEach(() => vi.resetAllMocks());

describe("record reversible-mutation adapters", () => {
  it.each([
    "complete",
    "dismiss",
  ] as const)("projects Follow-Up %s and inverses through reopen", async (intent) => {
    const adapter = followupLifecycleAdapter(intent);
    vi.mocked(reopenFollowupAction).mockResolvedValue({ ok: true, view: followup });

    expect(adapter.project(followup)).toBe(followup);
    await adapter.inverse(followup, { ...followup, status: "completed" });

    expect(reopenFollowupAction).toHaveBeenCalledWith({ followupId: followup.id });
  });

  it("restores the exact prior resolved Follow-Up state after reopen", async () => {
    const prior = { ...followup, status: "dismissed" as const };
    vi.mocked(dismissFollowupAction).mockResolvedValue({ ok: true, view: prior });

    await followupLifecycleAdapter("reopen").inverse(prior, followup);

    expect(dismissFollowupAction).toHaveBeenCalledWith({ followupId: prior.id });
    expect(completeFollowupAction).not.toHaveBeenCalled();
  });

  it("keeps Follow-Up exact while archiving and restores its prior state", async () => {
    const projected = followupLifecycleAdapter("archive").project(followup);
    vi.mocked(restoreArchivedFollowupAction).mockResolvedValue({ ok: true, view: followup });

    await followupLifecycleAdapter("archive").inverse(followup, projected);

    expect(projected).toBe(followup);
    expect(restoreArchivedFollowupAction).toHaveBeenCalledWith({ followupId: followup.id });
  });

  it("projects Saved Item archive and uses reopen as its inverse", async () => {
    const projected = savedItemLifecycleAdapter("archive", "member_owned").project(savedItem);
    vi.mocked(reopenSavedItemAction).mockResolvedValue({ ok: true, view: savedItem });

    await savedItemLifecycleAdapter("archive", "member_owned").inverse(savedItem, projected);

    expect(projected).toBe(savedItem);
    expect(reopenSavedItemAction).toHaveBeenCalledWith({ savedItemId: savedItem.id });
  });

  it("projects Saved Item reopen and uses archive as its inverse", async () => {
    const prior = { ...savedItem, status: "archived" as const, archived: true };
    vi.mocked(archiveSavedItemAction).mockResolvedValue({ ok: true, view: prior });

    await savedItemLifecycleAdapter("reopen", "member_owned").inverse(prior, savedItem);

    expect(archiveSavedItemAction).toHaveBeenCalledWith({ savedItemId: prior.id });
  });

  it("inverses a household-native Saved Item through the household boundary", async () => {
    vi.mocked(restoreHouseholdSavedItemAction).mockResolvedValue({
      ok: true,
      view: householdSavedItem,
    });

    await savedItemLifecycleAdapter("archive", "household_native").inverse(
      householdSavedItem,
      householdSavedItem,
    );

    expect(restoreHouseholdSavedItemAction).toHaveBeenCalledWith({
      savedItemId: householdSavedItem.id,
    });
    expect(reopenSavedItemAction).not.toHaveBeenCalled();
  });

  it("archives a household-native Saved Item back when reopen is undone", async () => {
    vi.mocked(archiveHouseholdSavedItemAction).mockResolvedValue({
      ok: true,
      view: householdSavedItem,
    });

    await savedItemLifecycleAdapter("reopen", "household_native").inverse(
      householdSavedItem,
      householdSavedItem,
    );

    expect(archiveHouseholdSavedItemAction).toHaveBeenCalledWith({
      savedItemId: householdSavedItem.id,
    });
    expect(archiveSavedItemAction).not.toHaveBeenCalled();
  });

  it("projects Today suppression by removing the candidate and delegates its inverse", async () => {
    const prior: TodayShortlistResponse = {
      candidateFingerprint: "fingerprint",
      curation: "deterministic",
      limitations: [],
      overflow: null,
      items: [
        {
          identity: "follow_up:1",
          family: "follow_up",
          title: "Check in",
          context: "Today",
          record: { kind: "follow_up", id: followup.id, href: "/people/1" },
          reason: { code: "due_today", key: "due", explanation: "Due today" },
          sourceRefs: [{ kind: "followup", id: followup.id }],
          action: { kind: "complete_follow_up", label: "Complete" },
          mandatory: true,
          dueAt: new Date("2026-08-12T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          sensitivity: "normal",
        },
      ],
    };
    const restore = vi.fn(async () => ({ ok: true as const, view: prior }));
    const adapter = todaySuppressionAdapter("follow_up:1", restore);

    expect(adapter.project(prior).items).toHaveLength(0);
    await adapter.inverse(prior, { ...prior, items: [] });

    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("keeps a Suggested Action exact while leaving and delegates authoritative restore", async () => {
    const prior = { action: { id: "action-1" } } as never;
    const restore = vi.fn(async () => ({ ok: true as const, view: prior }));
    const adapter = suggestedGeneralActionDismissAdapter(restore);

    expect(adapter.project(prior)).toBe(prior);
    await adapter.inverse(prior, prior);

    expect(restore).toHaveBeenCalledOnce();
  });

  it("keeps a Suggested Follow-Up exact while leaving and delegates authoritative restore", async () => {
    const prior = { followup: { id: "followup-1" } } as never;
    const restore = vi.fn(async () => ({ ok: true as const, view: prior }));
    const adapter = suggestedFollowupDismissAdapter(restore);

    expect(adapter.project(prior)).toBe(prior);
    await adapter.inverse(prior, prior);

    expect(restore).toHaveBeenCalledOnce();
  });

  it("keeps a Suggested Memory exact while leaving and delegates authoritative restore", async () => {
    const prior = { memory: { id: "memory-1" } } as never;
    const restore = vi.fn(async () => ({ ok: true as const, view: prior }));
    const adapter = suggestedMemoryDismissAdapter(restore);

    expect(adapter.project(prior)).toBe(prior);
    await adapter.inverse(prior, prior);

    expect(restore).toHaveBeenCalledOnce();
  });
});
