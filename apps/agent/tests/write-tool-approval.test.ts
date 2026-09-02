import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OPAQUE_DENIAL } from "../agent/lib/approval";
import { listEveModeDefinitions } from "../agent/lib/eve-modes";
import { runToolApproval, toolApprovalPolicy } from "./test-tool";
import { authorsTool } from "./tool-source";

/**
 * The registry is mocked here on purpose. What each describer *says* is pinned
 * where it lives (`packages/db/src/queries/approval-subjects.test.ts`); what a
 * tool has to do with the answer — park on `described`, deny opaquely on
 * `missing` — is a property of the gate, and this is where every gated tool is
 * checked for it at once.
 */
const { describeApprovalSubject } = vi.hoisted(() => ({ describeApprovalSubject: vi.fn() }));
vi.mock("@tendnote/db/queries/approval-subjects", () => ({ describeApprovalSubject }));

const denied = { type: "denied", reason: OPAQUE_DENIAL };
const agentRoot = join(import.meta.dirname, "../agent");

/**
 * Durable writes: anything that creates, mutates, archives, restores, deletes,
 * promotes, dismisses, or externalizes a persisted record. Every one of these
 * must declare an owner-approval policy, because omitting `approval` in eve
 * means `never()` — a new write tool without a gate is silently ungated, and
 * nothing else in the build would notice.
 */
const WRITE_TOOLS = [
  "accept_suggested_followup",
  "accept_suggested_general_action",
  "add_gift_idea",
  "approve_suggested_memory",
  "archive_memory",
  "archive_self_context",
  "capture_memory",
  "capture_saved_item",
  "capture_source_record",
  "change_saved_item_capture",
  "create_asset",
  "create_followup",
  "create_general_action",
  "create_person",
  "dismiss_draft",
  "dismiss_suggested_followup",
  "dismiss_suggested_general_action",
  "dismiss_suggested_memory",
  "edit_asset",
  "edit_draft_body",
  "edit_general_action",
  "edit_gift_idea",
  "propose_asset_memories",
  "remember_self_context",
  "remove_gift_idea",
  "restore_self_context",
  "save_draft_to_gmail",
  "undo_saved_item_capture",
  "update_followup_status",
  "update_general_action_status",
  "update_person",
  "update_self_context",
] as const;

/** The write tools whose gate resolves the record before the turn may park. */
const DESCRIBED_WRITE_TOOLS = new Set<string>(
  WRITE_TOOLS.filter(
    (name) =>
      ![
        // Legible from their own input: there is no id to turn back into a record,
        // so the frozen input the approval card renders is already the subject.
        "capture_saved_item",
        "create_asset",
        "create_general_action",
        "create_person",
        "propose_asset_memories",
        "remember_self_context",
      ].includes(name),
  ),
);

/**
 * External egress. Not a durable write, gated for the same reason: the owner has
 * to see the destination before anything leaves the process.
 */
const EGRESS_TOOLS = ["web_fetch"] as const;

/**
 * Tools whose gate is conditional on a model-supplied argument that widens
 * authority (`includeRestricted`, `acceptedProposal`, a widened
 * `requestedScope`). The call is ordinary until the flag is set, so the policy
 * carries a `when` predicate and this list is deliberately not asserted to park
 * unconditionally. Their own tests pin the flag behaviour.
 */
const FLAG_GATED_TOOLS = [
  "create_message_draft",
  "get_person_context",
  "get_relationship_agenda",
  "plan_suggested_general_actions",
  "propose_followup",
  "search_global_recall",
  "search_relationship_context",
  "search_semantic_context",
  "suggest_general_action",
] as const;

/**
 * Reads and proposal producers. A proposal writes only a `suggested` artifact a
 * real human control accepts later, which is the "Eve proposes" half of the
 * product and must stay ungated or the review queue can never be filled.
 */
const UNGATED_TOOLS = [
  "agent",
  "bash",
  "cleanup_preview",
  "connection_search",
  "eve_mode_gate",
  "get_asset_context",
  "get_gift_plan",
  "get_self_context_fact",
  "get_suggested_followup_review",
  "get_suggested_general_action_review",
  "get_suggested_memory_review",
  "household_check_in",
  "list_calendar_events",
  "list_due_followups",
  "list_general_action_areas",
  "list_general_actions",
  "list_message_drafts",
  "list_saved_items",
  "list_self_context",
  "list_suggested_followup_reviews",
  "list_suggested_general_action_reviews",
  "list_suggested_memory_reviews",
  "propose_asset_actions",
  "propose_suggested_memory",
  "read_file",
  "search_assets",
  "search_gift_plans",
  "search_people",
  "task_cancel",
  "task_update",
  "write_file",
] as const;

/**
 * The subset of {@link FLAG_GATED_TOOLS} that only ever reads. The rest of that
 * list produces a review artifact, so "this call may park" is a fair thing for
 * its description to say; these five answer a question and must not.
 */
const FLAG_GATED_READ_TOOLS = [
  "get_person_context",
  "get_relationship_agenda",
  "search_global_recall",
  "search_relationship_context",
  "search_semantic_context",
] as const;

function authoredToolFiles(): string[] {
  return readdirSync(join(agentRoot, "tools"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();
}

async function loadTool(name: string): Promise<unknown> {
  const loaded = (await import(`../agent/tools/${name}.ts`)) as { default: unknown };
  return loaded.default;
}

beforeEach(() => {
  vi.clearAllMocks();
  describeApprovalSubject.mockResolvedValue({
    kind: "described",
    subject: { title: "Do the thing", lines: [] },
  });
});

describe("the write surface is classified, and the classification is complete", () => {
  it("accounts for every file in the tools directory", () => {
    // The directory is the authority. A new tool file that nobody classified
    // fails here rather than shipping ungated, which is the whole point: eve
    // treats a missing `approval` as `never()` and says nothing about it.
    const classified = [
      ...WRITE_TOOLS,
      ...EGRESS_TOOLS,
      ...FLAG_GATED_TOOLS,
      ...UNGATED_TOOLS,
    ].sort();

    expect(classified).toEqual(authoredToolFiles());
  });

  it("classifies each tool exactly once", () => {
    const classified = [...WRITE_TOOLS, ...EGRESS_TOOLS, ...FLAG_GATED_TOOLS, ...UNGATED_TOOLS];
    expect(classified.length).toBe(new Set(classified).size);
  });

  it("leaves the framework-disabled sentinels and the mode gate unclassified as tools", () => {
    // They live in the same directory but author no tool, so a gate on them
    // would be meaningless. Pinned so the list above stays readable.
    const authored = authoredToolFiles().filter((name) =>
      authorsTool(readFileSync(join(agentRoot, "tools", `${name}.ts`), "utf8")),
    );
    for (const name of [...WRITE_TOOLS, ...EGRESS_TOOLS, ...FLAG_GATED_TOOLS]) {
      expect(authored, `${name} must author a tool to be gated`).toContain(name);
    }
  });
});

/**
 * A tool description is instruction, not documentation: it is what the model has
 * in front of it when it decides whether to call. When the write gates landed,
 * enough descriptions mentioned pausing that the model generalised the idea to
 * the whole tool set and started asking first - "Would you like me to search for
 * Sam?" instead of calling `search_people`, which parks for nobody. So a read's
 * top-level description may not say the call pauses. The one argument that does
 * park a read is the restricted-reveal flag, and it says so in its own
 * `.describe()`, where it is attached to the thing that is actually true of it.
 */
describe("a read never tells the model it pauses", () => {
  const readTools = [...UNGATED_TOOLS, ...FLAG_GATED_READ_TOOLS].filter((name) =>
    authorsTool(readFileSync(join(agentRoot, "tools", `${name}.ts`), "utf8")),
  );

  it("classifies the flag-gated reads as flag-gated", () => {
    for (const name of FLAG_GATED_READ_TOOLS) {
      expect(FLAG_GATED_TOOLS as readonly string[]).toContain(name);
    }
  });

  it.each(readTools)("%s describes itself as running, not parking", async (name) => {
    const { description } = (await loadTool(name)) as { description?: string };

    expect(
      description ?? "",
      `${name} is a read: nothing about it parks for an approval, so its description must not tell the model it might. Say what the restricted-reveal argument does in that argument's own .describe() instead.`,
    ).not.toMatch(/\bpauses?\b/i);
  });
});

describe("every durable write declares an owner-approval policy", () => {
  it.each([...WRITE_TOOLS, ...EGRESS_TOOLS])("%s is gated", async (name) => {
    expect(
      toolApprovalPolicy(await loadTool(name)),
      `${name} declares no approval policy, so nothing gates it: eve reads a missing approval as never().`,
    ).toBeTypeOf("function");
  });
});

describe("who a gated write may be asked of", () => {
  it.each([...WRITE_TOOLS])("%s parks an authenticated owner's web-chat turn", async (name) => {
    await expect(runToolApproval(await loadTool(name), { toolName: name })).resolves.toBe(
      "user-approval",
    );
  });

  it.each([...WRITE_TOOLS])("%s denies Eve's own runtime principal", async (name) => {
    // A scheduled workflow runs as `eve:app`; there is nobody to ask, so a
    // durable write from one fails closed rather than parking forever.
    await expect(
      runToolApproval(await loadTool(name), {
        toolName: name,
        principal: {
          attributes: {},
          authenticator: "app",
          principalId: "eve:app",
          principalType: "runtime",
        },
      }),
    ).resolves.toEqual(denied);
  });

  it.each([...WRITE_TOOLS])("%s denies a subagent turn", async (name) => {
    // Subagents propose; the parent session is where a person is.
    await expect(
      runToolApproval(await loadTool(name), { toolName: name, subagent: true }),
    ).resolves.toEqual(denied);
  });

  it.each([...WRITE_TOOLS])("%s denies an unauthenticated turn", async (name) => {
    await expect(
      runToolApproval(await loadTool(name), { toolName: name, principal: null }),
    ).resolves.toEqual(denied);
  });
});

describe("a record that is not the caller's never reaches the approval card", () => {
  it.each([...DESCRIBED_WRITE_TOOLS])(
    "%s denies opaquely when the record is missing",
    async (name) => {
      describeApprovalSubject.mockResolvedValue({ kind: "missing" });

      await expect(
        runToolApproval(await loadTool(name), {
          toolName: name,
          toolInput: { id: "someone-else's" },
        }),
      ).resolves.toEqual(denied);
    },
  );

  it.each([...DESCRIBED_WRITE_TOOLS])("%s asks the registry as the session owner", async (name) => {
    await runToolApproval(await loadTool(name), { toolName: name, toolInput: { a: 1 } });

    expect(describeApprovalSubject).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      toolName: name,
      input: { a: 1 },
    });
  });

  it.each([...DESCRIBED_WRITE_TOOLS])(
    "%s still parks when no describer is registered",
    async (name) => {
      // `unknown-tool` is not a refusal: the owner judges the raw input instead.
      describeApprovalSubject.mockResolvedValue({ kind: "unknown-tool" });

      await expect(runToolApproval(await loadTool(name), { toolName: name })).resolves.toBe(
        "user-approval",
      );
    },
  );

  it.each([...DESCRIBED_WRITE_TOOLS])("%s denies when the lookup itself fails", async (name) => {
    describeApprovalSubject.mockRejectedValue(new Error("connection refused"));

    await expect(runToolApproval(await loadTool(name), { toolName: name })).resolves.toEqual(
      denied,
    );
  });
});

/**
 * The registry is the real module here, not the mock above: what is being
 * asserted is the list itself.
 */
const { APPROVAL_SUBJECT_TOOL_NAMES } = await vi.importActual<
  typeof import("@tendnote/db/queries/approval-subjects")
>("@tendnote/db/queries/approval-subjects");

/** The arguments that widen what a call may do, in every spelling this agent uses. */
const AUTHORITY_FLAGS = [
  "includeRestricted",
  "directlyRequested",
  "acceptedProposal",
  "requestedScope",
] as const;

describe("a described subject and an authority flag never ride the same call", () => {
  // The web approval card renders the registry's description first and folds the
  // raw input behind a disclosure. That is right for a record — a uuid is not a
  // decision — and it is exactly wrong for an argument that widens what the call
  // may do: "Archive a memory about Ana" reads the same whether or not the call
  // also asked to reveal restricted context. So an authority flag must never be
  // describable away; it has to be the thing the owner is looking at.
  it("registers no describer for a flag-gated tool", () => {
    const both = FLAG_GATED_TOOLS.filter((name) => APPROVAL_SUBJECT_TOOL_NAMES.includes(name));
    expect(both).toEqual([]);
  });

  it.each([...APPROVAL_SUBJECT_TOOL_NAMES])("%s offers no authority flag", async (name) => {
    const tool = (await loadTool(name)) as { inputSchema: z.ZodType };
    const { properties } = z.toJSONSchema(tool.inputSchema, { io: "input" }) as {
      properties?: Record<string, unknown>;
    };

    for (const flag of AUTHORITY_FLAGS) {
      expect(Object.keys(properties ?? {}), `${name} may not offer ${flag}`).not.toContain(flag);
    }
  });
});

/**
 * The classification above and the mode table are two halves of one statement.
 * A tool in {@link WRITE_TOOLS} or {@link EGRESS_TOOLS} is gated
 * *unconditionally* - no `when` predicate, so every call reaches
 * `interactiveOwnerUserId`, and every mode but `web_chat` is denied there. A
 * mode allowlist that names one is therefore advertising a capability the
 * session can only ever be refused: `propose_asset_memories` sat in
 * `SCHEDULED_WORKFLOW_PROPOSALS` and `capture_source_record` in the Discord set
 * after ADR-0237 gated them both.
 *
 * The flag-gated tools are deliberately absent: their calls are ordinary until
 * the model sets the argument, so an unattended mode may hold one and simply
 * never widen it.
 */
describe("no mode advertises a tool its own sessions could only be refused", () => {
  const UNCONDITIONALLY_GATED = new Set<string>([...WRITE_TOOLS, ...EGRESS_TOOLS]);

  it("names an unconditionally gated tool in no allowlist outside web_chat", () => {
    const advertised = listEveModeDefinitions()
      .filter((definition) => definition.mode !== "web_chat")
      .flatMap((definition) =>
        definition.tools
          .filter((tool) => UNCONDITIONALLY_GATED.has(tool))
          .map((tool) => `${definition.mode}: ${tool}`),
      );

    expect(
      advertised,
      "Each of these parks for an owner approval that only `web_chat` can answer, so the mode denies it. Remove it from the allowlist, or give that surface a way to render and answer an approval.",
    ).toEqual([]);
  });
});

describe("a gated write asks every time", () => {
  it("does not accept an earlier approval of the same tool as this call's answer", async () => {
    // `ctx.approvedTools` is eve's session-wide `once()` memory. A durable write
    // is not authorised by an unrelated earlier call to the same tool.
    await expect(
      runToolApproval(await loadTool("archive_memory"), {
        toolName: "archive_memory",
        approvedTools: ["archive_memory"],
      }),
    ).resolves.toBe("user-approval");
  });
});
