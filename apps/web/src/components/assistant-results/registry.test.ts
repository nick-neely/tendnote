import { RENDERED_TOOL_NAMES } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";
import {
  ALL_RESULT_KINDS,
  assistantToolViewKey,
  GROUPABLE_KINDS,
  INTERACTIVE_RESULT_KINDS,
  RESULT_MODULES,
  toAssistantToolView,
  toolProjectors,
  toolViewTier,
} from "./registry";

/**
 * The registry-level guarantees this deep-module design adds. The per-kind behavior
 * (projection, trust language, tiers, keys, rendering) is exercised through the
 * dispatcher in tool-result-view.test.ts and assistant-tool-result.test.tsx; these
 * tests instead prove the *shape* of the system:
 *
 * - completeness — every fixed typed result kind owns a module with validation and
 *   rendering behavior, and every rendered tool is routed by exactly one of them;
 * - the deletion test — the dispatchers hold no per-kind policy; each kind's tier,
 *   identity, and rendering resolve through its module, so deleting a module removes
 *   that behavior rather than spreading it back across the callers.
 */

/**
 * The full fixed typed result set. Hardcoded so adding or removing a kind forces a
 * deliberate update here — the completeness anchor.
 */
const EXPECTED_KINDS: AssistantToolView["kind"][] = [
  "saved_source_record",
  "saved_memory",
  "added_person",
  "updated_person",
  "person_update_undo",
  "person_context",
  "suggested_memory_review",
  "suggested_memory_review_list",
  "relationship_context_search",
  "semantic_context_search",
  "global_recall",
  "relationship_agenda",
  "memory_curator_proposals",
  "suggested_followup_review",
  "suggested_followup_review_list",
  "message_draft",
  "draft_proposal",
  "created_general_action",
  "suggested_general_action_review",
  "suggested_general_action_review_list",
  "general_action_list",
  "asset_search",
  "asset_review_group",
  "asset_context",
  // Phase 8's household-aware surfaces (#390). They are typed rather than generic
  // precisely because they are the highest-stakes results on the panel: a shared
  // read, an exclusion-bearing search, and the audience a Capture actually wrote
  // with are three things a member must be able to read rather than infer from
  // Eve's prose.
  "household_check_in",
  "gift_plan_search",
  "gift_idea_added",
  "capture_outcome",
  "generic",
];

describe("result-module registry completeness", () => {
  it("registers exactly one module for every fixed typed result kind", () => {
    expect(new Set(ALL_RESULT_KINDS)).toEqual(new Set(EXPECTED_KINDS));
    expect(ALL_RESULT_KINDS).toHaveLength(EXPECTED_KINDS.length);
  });

  it("keys every module by its own kind (no mis-filed module)", () => {
    for (const kind of ALL_RESULT_KINDS) {
      expect(RESULT_MODULES[kind].kind).toBe(kind);
    }
  });

  it("gives every kind rendering behavior — a presentational render or a client card", () => {
    for (const kind of ALL_RESULT_KINDS) {
      const module = RESULT_MODULES[kind];
      const hasRendering = typeof module.render === "function" || module.interactive === true;
      expect(hasRendering, `${kind} has no rendering behavior`).toBe(true);
    }
  });

  it("gives every non-generic kind validation — at least one persisted-output parser", () => {
    for (const kind of ALL_RESULT_KINDS) {
      if (kind === "generic") continue;
      const parsers = Object.keys(RESULT_MODULES[kind].parsers);
      expect(parsers.length, `${kind} has no parser`).toBeGreaterThan(0);
    }
  });

  it("routes every rendered tool through exactly one module, with no orphan or extra", () => {
    // Each rendered tool has a projector...
    for (const toolName of RENDERED_TOOL_NAMES) {
      expect(toolProjectors[toolName], `${toolName} has no projector`).toBeDefined();
    }
    // ...and the projector table has no entry that is not a rendered tool.
    const rendered = new Set<string>(RENDERED_TOOL_NAMES);
    for (const toolName of Object.keys(toolProjectors)) {
      expect(rendered.has(toolName), `${toolName} is not a rendered tool`).toBe(true);
    }
    // Every rendered tool appears in exactly one module (no double-registration).
    const seen = new Map<string, number>();
    for (const kind of ALL_RESULT_KINDS) {
      for (const toolName of Object.keys(RESULT_MODULES[kind].parsers)) {
        seen.set(toolName, (seen.get(toolName) ?? 0) + 1);
      }
    }
    for (const toolName of RENDERED_TOOL_NAMES) {
      expect(seen.get(toolName), `${toolName} is registered in ${seen.get(toolName)} modules`).toBe(
        1,
      );
    }
    expect([...seen.keys()].sort()).toEqual([...RENDERED_TOOL_NAMES].sort());
  });

  it("declares the grouping set on the modules, not in the grouper", () => {
    const groupable = ALL_RESULT_KINDS.filter((kind) => RESULT_MODULES[kind].groupable === true);
    expect(new Set(groupable)).toEqual(new Set(GROUPABLE_KINDS));
  });

  it("declares the interactive set on the modules, matching the client-seam tuple", () => {
    // The tuple (INTERACTIVE_RESULT_KINDS) types the turn-unit's non-optional renderer
    // map at compile time; this asserts the per-module `interactive: true` flags name
    // exactly that same set, so the flag and the client-seam guarantee can't drift.
    const flagged = new Set(
      ALL_RESULT_KINDS.filter((kind) => RESULT_MODULES[kind].interactive === true),
    );
    expect(flagged).toEqual(new Set(INTERACTIVE_RESULT_KINDS));
  });
});

describe("result-module registry — the deletion test", () => {
  // Representative views spanning every rendering shape: a durable card, an ambient
  // line, an empty vs non-empty disclosure, a safe not-found, and the fallback. If a
  // dispatcher held per-kind policy, one of these would diverge from its module.
  const samples: AssistantToolView[] = [
    {
      kind: "saved_memory",
      memoryId: "m1",
      sourceRecordId: null,
      personId: null,
      personName: null,
      content: "x",
    },
    {
      kind: "person_context",
      personId: "p1",
      personName: "Mara",
      snapshotStatus: "fresh",
      approvedCount: 0,
      loggedCount: 0,
      suggestedCount: 0,
    },
    { kind: "relationship_context_search", results: [] },
    {
      kind: "asset_context",
      found: false,
      assetName: null,
      snapshotStatus: null,
      summary: null,
      facts: [],
      evidence: [],
      actions: [],
    },
    { kind: "generic", toolName: "some_future_tool" },
  ];

  it("resolves tier and identity through the owning module, not the dispatcher", () => {
    for (const view of samples) {
      const module = RESULT_MODULES[view.kind];
      const tier = module.tier as (v: AssistantToolView) => string;
      const key = module.key as (v: AssistantToolView) => string;
      expect(toolViewTier(view)).toBe(tier(view));
      expect(assistantToolViewKey(view)).toBe(key(view));
    }
  });

  it("keeps the parse fallback safe: an unknown tool degrades to generic, never a fabricated record", () => {
    expect(toAssistantToolView({ toolName: "not_a_tool", output: { anything: true } })).toEqual({
      kind: "generic",
      toolName: "not_a_tool",
    });
  });

  it("keeps three honest fallbacks distinct: benign unknown, well-formed negative, and malformed", () => {
    // 1. Unknown tool → benign generic (no flags).
    expect(toAssistantToolView({ toolName: "not_a_tool", output: {} })).toEqual({
      kind: "generic",
      toolName: "not_a_tool",
    });
    // 2. Known tool, well-formed negative (found:false) → neutral note, never malformed.
    expect(
      toAssistantToolView({ toolName: "list_general_actions", output: { found: false } }),
    ).toEqual({ kind: "generic", toolName: "list_general_actions", note: "Nothing on your list" });
    // 3. Known tool, schema-invalid payload (no negative flag) → malformed, shown degraded.
    expect(toAssistantToolView({ toolName: "capture_memory", output: { memory: null } })).toEqual({
      kind: "generic",
      toolName: "capture_memory",
      malformed: true,
    });
  });
});
