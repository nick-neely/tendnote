import { describe, expect, it, vi } from "vitest";

/**
 * The owner-binding guard on `recordEveSessionToolTrust` is a `WHERE` clause,
 * and whether a `WHERE` clause reaches Postgres is not something a pure test can
 * answer. That question is answered for real against the disposable dev database
 * by `pnpm --filter @tendnote/db db:eve-session-tool-trusts:check`, following
 * the same split `assistant_conversations` uses.
 *
 * What is worth testing here is the part that runs before any statement does:
 * a tool name the caller supplied is bounded, and an input that fails to parse
 * records nothing and never reaches the database at all.
 */
const execute = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());

vi.mock("../client", () => ({ getDb: () => ({ execute, select }) }));

const {
  EVE_SESSION_TOOL_TRUST_TOOL_NAME_MAX_LENGTH,
  hasEveSessionToolTrust,
  recordEveSessionToolTrust,
} = await import("./eve-session-tool-trusts");

const OWNER = "user-1";
const SESSION = "wrun_1";

describe("session tool trust input bounds", () => {
  it("records nothing for a tool name past the bound, without a statement", async () => {
    execute.mockClear();
    const toolName = "a".repeat(EVE_SESSION_TOOL_TRUST_TOOL_NAME_MAX_LENGTH + 1);

    await expect(
      recordEveSessionToolTrust({ ownerUserId: OWNER, sessionId: SESSION, toolName }),
    ).resolves.toEqual({ recorded: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it("records nothing for an empty owner, session, or tool name", async () => {
    execute.mockClear();

    await expect(
      recordEveSessionToolTrust({
        ownerUserId: "",
        sessionId: SESSION,
        toolName: "capture_memory",
      }),
    ).resolves.toEqual({ recorded: false });
    await expect(
      recordEveSessionToolTrust({ ownerUserId: OWNER, sessionId: "", toolName: "capture_memory" }),
    ).resolves.toEqual({ recorded: false });
    await expect(
      recordEveSessionToolTrust({ ownerUserId: OWNER, sessionId: SESSION, toolName: "   " }),
    ).resolves.toEqual({ recorded: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it("issues one guarded statement for a valid trust and reports whether it landed", async () => {
    execute.mockClear();
    execute.mockResolvedValueOnce([{ session_id: SESSION }]);

    await expect(
      recordEveSessionToolTrust({
        ownerUserId: OWNER,
        sessionId: SESSION,
        toolName: "capture_memory",
      }),
    ).resolves.toEqual({ recorded: true });
    expect(execute).toHaveBeenCalledTimes(1);

    // A foreign or unknown session selects nothing, so nothing is inserted, and
    // the two are the same opaque answer (ADR 0219).
    execute.mockResolvedValueOnce([]);
    await expect(
      recordEveSessionToolTrust({
        ownerUserId: OWNER,
        sessionId: SESSION,
        toolName: "capture_memory",
      }),
    ).resolves.toEqual({ recorded: false });
  });

  it("answers false for an out-of-bounds tool name without reading", async () => {
    select.mockClear();

    await expect(hasEveSessionToolTrust({ sessionId: SESSION, toolName: "  " })).resolves.toBe(
      false,
    );
    expect(select).not.toHaveBeenCalled();
  });
});
