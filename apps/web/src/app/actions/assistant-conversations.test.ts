import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductRateLimitError } from "@/lib/rate-limit/errors";
import {
  enforceProductBudgetSpy,
  requireAdmittedOwnerForActionSpy,
} from "@/test/action-adapter-mocks";

/**
 * What only these adapters can get wrong.
 *
 * A session id reaches `recordAssistantConversationAction` straight from the
 * browser and is the primary key of the row it inserts, so this is the one place
 * owner scoping cannot be a `WHERE` clause: the row does not exist yet. The
 * check that stands in for it is `eve_session_owners`, written from inside eve's
 * own durable execution (ADR 0238), and these tests are about that check.
 */

const { getEveSessionOwnerUserId, queries } = vi.hoisted(() => ({
  getEveSessionOwnerUserId: vi.fn(),
  queries: {
    archiveAssistantConversation: vi.fn(),
    listAssistantConversations: vi.fn(),
    renameAssistantConversation: vi.fn(),
    unarchiveAssistantConversation: vi.fn(),
    upsertAssistantConversation: vi.fn(),
  },
}));

vi.mock("@tendnote/db/queries/assistant-conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tendnote/db/queries/assistant-conversations")>()),
  ...queries,
}));
vi.mock("@tendnote/db/queries/eve-session-owners", () => ({ getEveSessionOwnerUserId }));

import {
  archiveAssistantConversationAction,
  listAssistantConversationsAction,
  recordAssistantConversationAction,
  renameAssistantConversationAction,
} from "./assistant-conversations";

const STORED = {
  sessionId: "wrun_1",
  ownerUserId: "owner-1",
  title: "Notes on Jordan",
  titleSource: "placeholder" as const,
  firstMessage: "Notes on Jordan",
  lastActivityAt: new Date("2026-09-01T10:00:00Z"),
  archivedAt: null,
  createdAt: new Date("2026-09-01T10:00:00Z"),
  updatedAt: new Date("2026-09-01T10:00:00Z"),
};

beforeEach(() => {
  getEveSessionOwnerUserId.mockReset();
  for (const query of Object.values(queries)) query.mockReset();
  enforceProductBudgetSpy.mockReset();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
});

describe("recordAssistantConversationAction", () => {
  it("records a session eve bound to this caller, and charges the budget", async () => {
    getEveSessionOwnerUserId.mockResolvedValue("owner-1");

    await expect(
      recordAssistantConversationAction({ sessionId: "wrun_1", firstMessage: "Hello" }),
    ).resolves.toEqual({ ok: true, view: { sessionId: "wrun_1", recorded: true } });

    expect(queries.upsertAssistantConversation).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      sessionId: "wrun_1",
      firstMessage: "Hello",
    });
    expect(enforceProductBudgetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "owner-1", costCategory: "server-action" }),
    );
  });

  /**
   * The attack this closes: pre-claim an id eve has not minted yet, and hold the
   * row that session's own hook later writes its model title into.
   */
  it("inserts nothing for a session id bound to somebody else", async () => {
    getEveSessionOwnerUserId.mockResolvedValue("owner-2");

    await expect(recordAssistantConversationAction({ sessionId: "wrun_1" })).resolves.toEqual({
      ok: true,
      view: { sessionId: "wrun_1", recorded: false },
    });
    expect(queries.upsertAssistantConversation).not.toHaveBeenCalled();
  });

  it("inserts nothing for a session id nobody is bound to, and says the same thing", async () => {
    getEveSessionOwnerUserId.mockResolvedValue(null);

    await expect(recordAssistantConversationAction({ sessionId: "wrun_guess" })).resolves.toEqual({
      ok: true,
      view: { sessionId: "wrun_guess", recorded: false },
    });
    expect(queries.upsertAssistantConversation).not.toHaveBeenCalled();
  });

  it("does not reach the binding lookup at all when the budget refuses", async () => {
    enforceProductBudgetSpy.mockRejectedValueOnce(
      new ProductRateLimitError({
        allowed: false,
        limit: 60,
        count: 61,
        remaining: 0,
        resetAt: new Date("2026-09-01T10:01:00Z"),
        costCategory: "server-action",
        reason: "limit_exceeded",
      }),
    );

    const result = await recordAssistantConversationAction({ sessionId: "wrun_1" });

    expect(result.ok).toBe(false);
    expect(getEveSessionOwnerUserId).not.toHaveBeenCalled();
    expect(queries.upsertAssistantConversation).not.toHaveBeenCalled();
  });
});

describe("the owner-scoped adapters", () => {
  it("lists through the same runner its siblings use, owner from the session", async () => {
    queries.listAssistantConversations.mockResolvedValue([STORED]);

    await expect(listAssistantConversationsAction({ includeArchived: true })).resolves.toEqual({
      ok: true,
      view: [
        {
          sessionId: "wrun_1",
          title: "Notes on Jordan",
          lastActivityAt: STORED.lastActivityAt,
          archived: false,
        },
      ],
    });
    expect(queries.listAssistantConversations).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      includeArchived: true,
    });
  });

  it("answers a malformed limit as data rather than throwing at the browser", async () => {
    await expect(listAssistantConversationsAction({ limit: 5000 })).resolves.toMatchObject({
      ok: false,
    });
    expect(queries.listAssistantConversations).not.toHaveBeenCalled();
  });

  it("hands back the stored row for a rename, and charges the budget", async () => {
    queries.renameAssistantConversation.mockResolvedValue({ ...STORED, title: "Jordan check-in" });

    await expect(
      renameAssistantConversationAction({ sessionId: "wrun_1", title: "Jordan check-in" }),
    ).resolves.toMatchObject({ ok: true, view: { title: "Jordan check-in" } });
    expect(enforceProductBudgetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ costCategory: "server-action" }),
    );
  });

  /** Somebody else's id matches no row, and says so exactly as a missing one would. */
  it("answers null for a thread that is not this owner's", async () => {
    queries.archiveAssistantConversation.mockResolvedValue(null);

    await expect(archiveAssistantConversationAction({ sessionId: "wrun_other" })).resolves.toEqual({
      ok: true,
      view: null,
    });
  });
});
