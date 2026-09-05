import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REVERSIBLE_PRIVATE_WRITE_TOOL_NAMES } from "@tendnote/domain/eve-approvals";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OPAQUE_DENIAL } from "../agent/lib/approval";
import { setApprovalPolicyDependencies } from "../agent/lib/approval/dependencies";
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
  "conversation_taint_gate",
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
  // Neither a read nor a write: it echoes back a filtered copy of its own input for
  // the chip strip, so there is no record for an owner to approve.
  "suggest_next_steps",
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

  it("leaves the framework-disabled sentinels and the dynamic resolvers unclassified as tools", () => {
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

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_RECORD_ID = "22222222-2222-4222-8222-222222222222";

/**
 * One widened call per flag-gated tool: the argument set to the value that asks
 * for more than an ordinary call, alongside whatever else that tool's schema
 * needs. The same inputs `approval-trust-flags.test.ts` uses, because the two
 * files are asking about the same call from opposite sides - that it parks at
 * all, and that the Approval Mode does not stop it parking.
 */
const WIDENING_INPUTS: Readonly<Record<string, Record<string, unknown>>> = {
  create_message_draft: { personId: PERSON_ID, includeRestricted: true },
  get_person_context: { personId: PERSON_ID, includeRestricted: true },
  get_relationship_agenda: {
    windowStart: "2026-07-01T00:00:00.000Z",
    windowEnd: "2026-07-08T00:00:00.000Z",
    directlyRequested: true,
  },
  plan_suggested_general_actions: {
    sourceRecordId: SOURCE_RECORD_ID,
    steps: [{ title: "Call the clinic" }],
    directlyRequested: true,
  },
  propose_followup: {
    personId: PERSON_ID,
    reason: "check in about the diagnosis",
    dueAt: "2026-07-08T00:00:00.000Z",
    sourceRecordId: SOURCE_RECORD_ID,
    directlyRequested: true,
  },
  search_global_recall: { query: "the diagnosis", family: "memory", includeRestricted: true },
  search_relationship_context: {
    query: "the diagnosis",
    visibilityScope: "all_visible",
    directlyRequested: true,
  },
  search_semantic_context: { query: "the diagnosis", directlyRequested: true },
  suggest_general_action: {
    title: "Call the clinic",
    sourceRecordId: SOURCE_RECORD_ID,
    directlyRequested: true,
  },
};

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
 *
 * A Reversible Private Write is not an exception. Its tier is read *after*
 * `interactiveOwnerUserId`, so a `scheduled_workflow` or `discord_capture`
 * session reaches the same denial it always did - the tier decides whether the
 * owner is asked, never whether a caller with no owner is refused.
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

/**
 * The Reversible Private Write tier (ADR-0240), and the rule that earns it.
 *
 * The list below is not the authority; the rule is. A tool is a Reversible
 * Private Write only if it is owner-scoped or owner-created, private by
 * construction with no argument that can widen its audience (or a predicate that
 * rejects the widening), legible to the owner as either a described subject or a
 * private-default create, and reversible by an undo, archive, restore, or
 * lifecycle path. Each clause below is checked against the tool itself, so a new
 * tool cannot join the tier by being added to a list.
 */
const REVERSIBLE_PRIVATE_WRITES = [
  "accept_suggested_followup",
  "accept_suggested_general_action",
  "approve_suggested_memory",
  "archive_memory",
  "archive_self_context",
  "capture_memory",
  "capture_saved_item",
  "capture_source_record",
  "change_saved_item_capture",
  "create_followup",
  "create_general_action",
  "create_person",
  "dismiss_suggested_followup",
  "dismiss_suggested_general_action",
  "dismiss_suggested_memory",
  "remember_self_context",
  "restore_self_context",
  "undo_saved_item_capture",
  "update_followup_status",
  "update_general_action_status",
  "update_self_context",
] as const;

/**
 * Tier 0: every gated call asks, in both Approval Modes. Each of these fails a
 * different clause of the rule, which is the point of checking a rule rather
 * than curating a list:
 *
 * - `add_gift_idea`, `edit_gift_idea`, `remove_gift_idea` write to a Gift Plan
 *   the caller shares with other co-planners, so nothing about them is private
 *   by construction - and `remove_gift_idea` says in its own description that
 *   removal is permanent, so it has no path back either.
 * - `create_asset`, `edit_asset`, `propose_asset_memories` write household
 *   Assets and their review queue: neither owner-scoped nor private.
 * - `save_draft_to_gmail` leaves the process. Nothing outside Tendnote can be
 *   taken back.
 * - `edit_draft_body` and `dismiss_draft` are the drafting surface: a draft is
 *   the text of a message to another person, an edit overwrites wording nothing
 *   keeps a copy of, and a dismissal throws the draft away.
 * - `edit_general_action` and `update_person` overwrite wording nothing keeps a
 *   copy of, and CONTEXT.md is explicit that an overwrite with no way back is
 *   never a Reversible Private Write. The Action's own status lifecycle is not a
 *   path back to the title it used to have. Both join the tier when an undo for
 *   the edit exists (#557 for the person half), not before: the tier follows the
 *   capability.
 */
const ALWAYS_ASK_WRITES = [
  "add_gift_idea",
  "create_asset",
  "dismiss_draft",
  "edit_asset",
  "edit_draft_body",
  "edit_general_action",
  "edit_gift_idea",
  "propose_asset_memories",
  "remove_gift_idea",
  "save_draft_to_gmail",
  "update_person",
] as const;

/**
 * The writes whose subject the owner reads off the frozen input because the call
 * *creates* the record, privately, and there is no id to resolve. The rule's
 * legibility clause is satisfied by either this or a registered describer.
 */
const PRIVATE_DEFAULT_CREATES = new Set<string>([
  "capture_saved_item",
  "create_general_action",
  "create_person",
  "remember_self_context",
]);

/**
 * How each Reversible Private Write is taken back.
 *
 * A `tool` entry names an Eve tool that performs the inverse and is checked
 * against the tools directory, so a renamed or deleted reversal fails here
 * rather than leaving a tier claim standing on nothing. A `lifecycle` entry is
 * for the writes whose path back is a status transition or an app action rather
 * than another Eve call; the sentence has to say which.
 */
const REVERSAL_PATHS: Readonly<Record<string, { tool: string } | { lifecycle: string }>> = {
  accept_suggested_followup: { tool: "update_followup_status" },
  accept_suggested_general_action: { tool: "update_general_action_status" },
  approve_suggested_memory: { tool: "archive_memory" },
  archive_memory: {
    lifecycle:
      "Archiving is a status transition, not a deletion: the memory row and its source record survive, which is what the tool's own description promises the user.",
  },
  archive_self_context: { tool: "restore_self_context" },
  capture_memory: { tool: "archive_memory" },
  capture_saved_item: { tool: "undo_saved_item_capture" },
  capture_source_record: {
    lifecycle:
      "A source record carries the owner-scoped active/dismissed/archived lifecycle (`source_record_status`); it is never written as something only a deletion could undo.",
  },
  change_saved_item_capture: {
    lifecycle:
      "The change is wording on the destination record the capture created, so a wrong change is changed again and the capture itself is still undone by undo_saved_item_capture.",
  },
  create_followup: { tool: "update_followup_status" },
  create_general_action: { tool: "update_general_action_status" },
  create_person: {
    lifecycle:
      "A person the owner did not want is deleted in the app (`deletePerson`), which is why creating one is the reversible half and updating one is not (#557).",
  },
  dismiss_suggested_followup: { tool: "update_followup_status" },
  dismiss_suggested_general_action: { tool: "update_general_action_status" },
  dismiss_suggested_memory: {
    lifecycle:
      "A dismissed suggestion stays on the memory row and the app restores it to the review queue (`restoreDismissedSuggestedMemory`).",
  },
  remember_self_context: { tool: "archive_self_context" },
  restore_self_context: { tool: "archive_self_context" },
  undo_saved_item_capture: {
    lifecycle:
      "This is itself the reversal path, and it is a conservative one: it archives what the capture created and restores the prior Context Fact value while preserving source evidence.",
  },
  update_followup_status: { tool: "update_followup_status" },
  update_general_action_status: { tool: "update_general_action_status" },
  update_self_context: {
    lifecycle:
      "The Self Context lifecycle: a correction is another update against the same fact, and archive/restore takes the fact out and puts it back.",
  },
};

/** The Approval Mode a test wants the policy to read for this call. */
function withApprovalMode(mode: "ask" | "trusted"): void {
  setApprovalPolicyDependencies({ readApprovalMode: async () => mode });
}

describe("every durable write is assigned a tier, and the tier is earned", () => {
  it("assigns every write to exactly one tier", () => {
    // An unassigned tool fails here rather than shipping with the safe-looking
    // half of a decision nobody made.
    const assigned = [...REVERSIBLE_PRIVATE_WRITES, ...ALWAYS_ASK_WRITES].sort();
    expect(assigned.length, "a tool may not sit in both tiers").toBe(new Set(assigned).size);
    expect(
      assigned,
      "Every WRITE tool needs a tier: add it to REVERSIBLE_PRIVATE_WRITES only if it passes the rule below, and to ALWAYS_ASK_WRITES otherwise.",
    ).toEqual([...WRITE_TOOLS].sort());
  });

  it("is the same list the web card reads for its trust offer", async () => {
    // The approval card offers "Don't ask again for this in this conversation"
    // only where the policy would honour it, and a browser cannot see a tier: it
    // reads the shared list in `@tendnote/domain/eve-approvals`. That list is a
    // copy, so this is where it is held to the declarations themselves - not to
    // REVERSIBLE_PRIVATE_WRITES above, but to what each gate actually does in the
    // mode that skips the click.
    withApprovalMode("trusted");

    const declaring: string[] = [];
    for (const name of WRITE_TOOLS) {
      const status = await runToolApproval(await loadTool(name), { toolName: name });
      if (status === "not-applicable") declaring.push(name);
    }

    expect(
      [...REVERSIBLE_PRIVATE_WRITE_TOOL_NAMES].sort(),
      "REVERSIBLE_PRIVATE_WRITE_TOOL_NAMES in @tendnote/domain/eve-approvals has drifted from the tools' own reversiblePrivateWrite declarations.",
    ).toEqual(declaring.sort());
  });

  it.each([...REVERSIBLE_PRIVATE_WRITES])(
    "%s runs without asking in trusted mode",
    async (name) => {
      // The declaration on the tool is the only thing that can produce this, so
      // this is the list and the code agreeing rather than the list alone.
      withApprovalMode("trusted");

      await expect(runToolApproval(await loadTool(name), { toolName: name })).resolves.toBe(
        "not-applicable",
      );
    },
  );

  it.each([...REVERSIBLE_PRIVATE_WRITES])("%s still asks in ask mode", async (name) => {
    withApprovalMode("ask");

    await expect(runToolApproval(await loadTool(name), { toolName: name })).resolves.toBe(
      "user-approval",
    );
  });

  it.each([...ALWAYS_ASK_WRITES, ...EGRESS_TOOLS])("%s asks even in trusted mode", async (name) => {
    withApprovalMode("trusted");

    await expect(
      runToolApproval(await loadTool(name), {
        toolName: name,
        // `web_fetch` denies a call with no URL to show, so give every tool a
        // subject-shaped input; the registry mock accepts anything.
        toolInput: { id: "r1", url: "https://example.com/page" },
      }),
    ).resolves.toBe("user-approval");
  });

  it.each([...FLAG_GATED_TOOLS])("%s asks even in trusted mode once widened", async (name) => {
    // The flag-gated tools declare no tier, so every one of them is always-ask
    // once its widening argument is set. `trusted` is the mode where that is
    // worth stating: an owner who stopped clicking on private saves has not
    // agreed to a restricted reveal, an accepted-proposal persist, or a
    // household audience, and the absent declaration is the only thing standing
    // between them. `approval-trust-flags.test.ts` owns what each flag means;
    // this owns that the mode never reaches past it.
    withApprovalMode("trusted");

    const widening = WIDENING_INPUTS[name];
    expect(
      widening,
      `${name} is flag-gated, so WIDENING_INPUTS needs the call that sets its argument`,
    ).toBeDefined();

    await expect(
      runToolApproval(await loadTool(name), { toolName: name, toolInput: widening }),
    ).resolves.toBe("user-approval");
  });

  it.each([...REVERSIBLE_PRIVATE_WRITES])(
    "%s offers no argument that widens its audience without a predicate that rejects it",
    async (name) => {
      const tool = (await loadTool(name)) as { inputSchema: z.ZodType };
      const { properties } = z.toJSONSchema(tool.inputSchema, { io: "input" }) as {
        properties?: Record<string, unknown>;
      };
      const offered = AUTHORITY_FLAGS.filter((flag) =>
        Object.keys(properties ?? {}).includes(flag),
      );

      withApprovalMode("trusted");
      for (const flag of offered) {
        // Private by construction, or a predicate that rejects the widening. The
        // second is proved the only way it can be: by the call the argument
        // makes still parking for the owner in the mode that skips the click.
        await expect(
          runToolApproval(await loadTool(name), {
            toolName: name,
            toolInput: { [flag]: flag === "requestedScope" ? "household" : true },
          }),
          `${name} offers ${flag}, so its reversiblePrivateWrite predicate must reject a call that sets it`,
        ).resolves.toBe("user-approval");
      }
    },
  );

  it.each([...REVERSIBLE_PRIVATE_WRITES])(
    "%s shows the owner what it is about to write",
    (name) => {
      // Either the registry resolves the record this call names, or the call
      // creates a private record whose whole subject is the frozen input the
      // approval card already renders. A reversible write that is neither is one
      // the owner cannot actually judge.
      expect(
        DESCRIBED_WRITE_TOOLS.has(name) || PRIVATE_DEFAULT_CREATES.has(name),
        `${name} needs a registered describer or a place in PRIVATE_DEFAULT_CREATES`,
      ).toBe(true);
    },
  );

  it.each([...REVERSIBLE_PRIVATE_WRITES])("%s names a path back", (name) => {
    const reversal = REVERSAL_PATHS[name];
    expect(reversal, `${name} claims the tier, so it has to say how it is undone`).toBeDefined();
    if (reversal === undefined) return;

    if ("tool" in reversal) {
      expect(
        authoredToolFiles(),
        `${name} names ${reversal.tool} as its reversal, and that tool does not exist`,
      ).toContain(reversal.tool);
      return;
    }
    // A lifecycle note has to say something; an empty string would let a tier
    // claim rest on a blank line.
    expect(reversal.lifecycle.length).toBeGreaterThan(40);
  });
});

/**
 * The tier is invisible to the model, and the wording has to match.
 *
 * A Reversible Private Write does not pause for a `trusted` owner in an
 * untainted conversation, so a description that says it does is simply wrong -
 * and the model reads the description as instruction, not documentation. What
 * pauses in this conversation is stated once per turn by the dynamic approval
 * posture instruction instead (`agent/instructions/approval-posture.ts`), which
 * speaks in categories and never names a tool.
 */
describe("no Reversible Private Write tells the model it pauses", () => {
  /**
   * `pause/resume` is one of the General Action lifecycle transitions
   * `update_general_action_status` applies to a Routine - the user's own word for
   * setting a recurring action aside. It has nothing to do with an approval, and
   * removing it is the only way to ask about the approval sense of "pause".
   */
  function approvalWording(description: string): string {
    return description.replace(/\bpause\/resume\b/gi, "");
  }

  it.each([...REVERSIBLE_PRIVATE_WRITES])("%s describes itself as running", async (name) => {
    const { description } = (await loadTool(name)) as { description?: string };

    expect(
      approvalWording(description ?? ""),
      `${name} is a Reversible Private Write: it runs immediately for a trusted owner, so its description must not tell the model it pauses.`,
    ).not.toMatch(/\bpauses?\b/i);
  });

  it.each([...ALWAYS_ASK_WRITES, ...EGRESS_TOOLS])("%s keeps saying it pauses", async (name) => {
    // Still true of these in both modes, and the sentence is what stops the
    // model claiming a write happened while the owner is still looking at it.
    const { description } = (await loadTool(name)) as { description?: string };

    expect(description ?? "", `${name} always asks, so it should still say so`).toMatch(
      /\bpauses?\b/i,
    );
  });
});
