import type { DynamicResolveContext, DynamicToolEntry, ToolContext } from "eve/tools";
import { describe, expect, it } from "vitest";
import { EVE_TOOL_NAMES } from "../agent/lib/eve-modes";
import gate from "../agent/tools/eve_mode_gate";

type Principal = { principalType: string; attributes?: Record<string, string> };

/** The only part of the resolver context this gate reads: the active turn's caller. */
function resolveContext(current: Principal | null): DynamicResolveContext {
  return {
    session: { id: "session-1", auth: { current, initiator: current } },
    channel: {},
    messages: [],
  } as unknown as DynamicResolveContext;
}

const resolveTurn = gate.events["turn.started"];

async function withheldTools(current: Principal | null): Promise<Record<string, DynamicToolEntry>> {
  expect(resolveTurn, "the gate must resolve on turn.started").toBeDefined();
  const resolved = await resolveTurn?.({}, resolveContext(current));
  return (resolved ?? {}) as Record<string, DynamicToolEntry>;
}

const WEB_OWNER: Principal = { principalType: "user", attributes: { channel: "eve" } };

describe("Eve mode gate", () => {
  it("leaves a signed-in web session exactly as authored", async () => {
    // `null` means this resolver contributes nothing, so every authored tool
    // reaches the model with its own description, schema, and toModelOutput.
    expect(await resolveTurn?.({}, resolveContext(WEB_OWNER))).toBeNull();
  });

  it("withholds everything but capture from a Discord-stamped session", async () => {
    const withheld = await withheldTools({
      principalType: "user",
      attributes: { channel: "discord" },
    });

    expect(Object.keys(withheld)).not.toContain("capture_source_record");
    for (const tool of ["create_message_draft", "save_draft_to_gmail", "capture_memory"]) {
      expect(Object.keys(withheld), tool).toContain(tool);
    }
    expect(Object.keys(withheld)).toHaveLength(EVE_TOOL_NAMES.length - 1);
  });

  it("reports, rather than performs, a call the mode does not allow", async () => {
    const withheld = await withheldTools({
      principalType: "user",
      attributes: { channel: "discord" },
    });

    const draft = withheld.create_message_draft;
    expect(draft?.description).toContain("Unavailable in discord_capture mode");

    // A withheld name is bound to this definition for the whole turn, so the
    // authored executor cannot run even if the model insists on calling it.
    const result = await draft?.execute({ personId: "p1" }, {} as ToolContext);
    expect(result).toMatchObject({ performed: false, mode: "discord_capture" });
    expect(String((result as { message: string }).message)).toContain("not available");
  });

  it("withholds every interactive and durable-write tool from a scheduled session", async () => {
    const withheld = Object.keys(await withheldTools({ principalType: "runtime" }));

    for (const tool of [
      "create_message_draft",
      "save_draft_to_gmail",
      "capture_saved_item",
      "household_check_in",
      "cleanup_preview",
      "approve_suggested_memory",
      "update_person",
    ]) {
      expect(withheld, tool).toContain(tool);
    }

    // Reads and review-gated proposals are what a workflow is for.
    for (const tool of [
      "get_relationship_agenda",
      "list_due_followups",
      "list_calendar_events",
      "propose_followup",
      "suggest_general_action",
    ]) {
      expect(withheld, tool).not.toContain(tool);
    }
  });

  it("withholds the whole surface from a session with no recognised principal", async () => {
    expect(Object.keys(await withheldTools(null)).sort()).toEqual([...EVE_TOOL_NAMES].sort());
    expect(
      Object.keys(await withheldTools({ principalType: "user", attributes: {} })),
    ).toHaveLength(EVE_TOOL_NAMES.length);
  });

  it("withholds the whole surface rather than throwing, because throwing fails open", async () => {
    // eve 0.32 skips a resolver that throws and runs the turn on the static
    // compiled set - the full authored surface. So the two ways this resolver
    // could fail have to resolve to `restricted` instead of escaping: a context
    // with no session at all, and one whose principal cannot even be read.
    const noSession = {} as DynamicResolveContext;
    const unreadablePrincipal = {
      session: {
        id: "session-1",
        auth: {
          get current(): Principal {
            throw new Error("principal store unavailable");
          },
        },
      },
      channel: {},
      messages: [],
    } as unknown as DynamicResolveContext;

    for (const ctx of [noSession, unreadablePrincipal]) {
      const withheld = (await resolveTurn?.({}, ctx)) as Record<string, DynamicToolEntry>;
      expect(Object.keys(withheld).sort()).toEqual([...EVE_TOOL_NAMES].sort());
      expect(withheld.create_message_draft?.description).toContain(
        "Unavailable in restricted mode",
      );
    }
  });
});
