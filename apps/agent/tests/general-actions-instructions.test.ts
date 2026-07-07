import { describe, expect, it } from "vitest";
import { authoredInstructions, baseInstructions } from "./instructions-source";

// The whole authored surface (base.md + every skill), so a rule that lives in the
// actions skill still counts as enforced guidance even if it later moves between base
// and a skill (see authoredInstructions).
const authored = authoredInstructions();
const base = baseInstructions();

describe("General Action instructions — explicit creation", () => {
  it("names the create tool and gates active creation on an explicit ask", () => {
    expect(authored).toMatch(/create_general_action/);
    expect(authored).toMatch(/[Nn]ever invent an active Action/);
    expect(authored).toMatch(/only when the user explicitly asks/i);
  });

  it("allows unscheduled actions and requires clarification on ambiguous timing", () => {
    expect(authored).toMatch(/unscheduled/i);
    expect(authored).toMatch(/ask a clarifying question/i);
  });

  it("distinguishes a Routine (cadence) from a one-time action", () => {
    expect(authored).toMatch(/Routine/);
    expect(authored).toMatch(/cadence/i);
  });
});

describe("General Action instructions — suggestion and shallow planning", () => {
  it("names the suggestion tool and keeps proposals grounded and tentative", () => {
    expect(authored).toMatch(/suggest_general_action/);
    expect(authored).toMatch(/grounded/i);
    expect(authored).toMatch(/tentative/i);
  });

  it("names the shallow-planning tool and forbids deep task trees", () => {
    expect(authored).toMatch(/plan_suggested_general_actions/);
    expect(authored).toMatch(/small, flat set|small,? flat/i);
    expect(authored).toMatch(/never sub-tasks, dependencies, phases, projects, or a kanban/i);
  });

  it("accepts or dismisses suggestions only on explicit user action", () => {
    expect(authored).toMatch(/accept_suggested_general_action/);
    expect(authored).toMatch(/dismiss_suggested_general_action/);
    expect(authored).toMatch(/[Nn]ever accept or dismiss on the user's behalf/);
  });
});

describe("General Action instructions — listing and cross-domain", () => {
  it("names the list tool and keeps it plain recall, not priority ranking", () => {
    expect(authored).toMatch(/list_general_actions/);
    expect(authored).toMatch(/not "what should I do first" priority ranking/i);
  });

  it("covers due, overdue, deferred, unscheduled, resurfaced, and routines", () => {
    for (const word of ["overdue", "deferred", "unscheduled", "resurfaced"]) {
      expect(authored.toLowerCase()).toContain(word);
    }
    expect(authored).toMatch(/routinesOnly/);
  });

  it("composes read-only tools across people, follow-ups, and actions for cross-domain answers", () => {
    expect(authored).toMatch(/cross-domain/i);
    expect(authored).toMatch(/list_due_followups/);
    expect(authored).toMatch(/search_semantic_context/);
    expect(authored).toMatch(/list_general_actions/);
  });
});

describe("General Action instructions — explicit mutation boundary (ADR 0159)", () => {
  it("names the mutation tools", () => {
    expect(authored).toMatch(/update_general_action_status/);
    expect(authored).toMatch(/edit_general_action/);
  });

  it("keeps the always-on mutation boundary in base instructions", () => {
    expect(base).toMatch(/Only create or change a durable Action on an explicit ask\./);
    expect(base).toMatch(
      /never from your own initiative, an inference, earlier context, or a schedule/i,
    );
  });

  it("requires deterministic record resolution and refuses bulk or inferred cleanup", () => {
    expect(authored).toMatch(/deterministic/i);
    expect(authored).toMatch(/ask which one/i);
    expect(authored).toMatch(/do not sweep/i);
    expect(authored).toMatch(/each mutation touches exactly one Action/i);
  });
});
