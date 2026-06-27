import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const toolsDir = join(process.cwd(), "agent/tools");

function readTool(name: string): string {
  return readFileSync(join(toolsDir, `${name}.ts`), "utf8");
}

const toolFiles = readdirSync(toolsDir).filter((file) => file.endsWith(".ts"));
const instructions = readFileSync(join(process.cwd(), "agent/instructions/base.md"), "utf8");

describe("Phase 1A assistant tools are thin wrappers over shared functions", () => {
  const wrappers: Record<string, string> = {
    capture_source_record: "captureSourceRecord",
    capture_memory: "captureExplicitMemory",
    create_person: "createPerson",
    search_people: "searchPeople",
    get_person_context: "getPersonContext",
    search_semantic_context: "searchSemanticContext",
    get_suggested_memory_review: "getSuggestedMemoryReview",
    list_suggested_memory_reviews: "listSuggestedMemoryReviews",
    approve_suggested_memory: "saveSuggestedMemory",
    dismiss_suggested_memory: "dismissSuggestedMemory",
    create_followup: "createFollowup",
    list_due_followups: "listActiveFollowups",
    update_followup_status: "snoozeFollowup",
    propose_followup: "suggestFollowup",
    list_suggested_followup_reviews: "listSuggestedFollowupReviews",
    get_suggested_followup_review: "getSuggestedFollowupReview",
    accept_suggested_followup: "acceptSuggestedFollowup",
    dismiss_suggested_followup: "dismissSuggestedFollowup",
    get_relationship_agenda: "getRelationshipAgenda",
  };

  for (const [tool, sharedFn] of Object.entries(wrappers)) {
    it(`${tool} calls the shared @tendnote/db function ${sharedFn}`, () => {
      const source = readTool(tool);
      // Tools import the shared function from a narrow @tendnote/db subpath so a
      // tool never bundles unrelated heavy deps (e.g. the `ai` SDK pulled by the
      // snapshot path). Match the package root with an optional subpath.
      expect(source).toMatch(/from\s+"@tendnote\/db(\/[\w-]+)*"/);
      expect(source).toContain(sharedFn);
    });
  }
});

describe("suggested-memory review tools return persisted ids and status", () => {
  it("get_suggested_memory_review returns the persisted component and memory id", () => {
    const source = readTool("get_suggested_memory_review");
    expect(source).toContain("component");
    expect(source).toMatch(/review\.memory\.id|memory:\s*\{/);
  });

  it("approve_suggested_memory returns the new status and persisted ids", () => {
    const source = readTool("approve_suggested_memory");
    expect(source).toMatch(/status:\s*result\.memory\.status/);
    expect(source).toContain("sourceRecordId");
    expect(source).toContain("component");
  });

  it("dismiss_suggested_memory returns the new status and persisted ids", () => {
    const source = readTool("dismiss_suggested_memory");
    expect(source).toMatch(/status:\s*memory\.status/);
    expect(source).toContain("sourceRecordId");
  });
});

describe("active follow-up tools are thin wrappers returning compact references", () => {
  it("create_followup requires a resolved person, reason, and concrete dueAt", () => {
    const source = readTool("create_followup");
    expect(source).toContain("createFollowup");
    expect(source).toMatch(/personId/);
    expect(source).toMatch(/reason/);
    expect(source).toMatch(/dueAt/);
    // Returns a compact persisted reference, not a raw model object.
    expect(source).toMatch(/id:\s*followup\.id/);
    expect(source).toMatch(/status:\s*followup\.status/);
  });

  it("list_due_followups lists active reminders by window or person, due-first", () => {
    const source = readTool("list_due_followups");
    expect(source).toContain("listActiveFollowups");
    expect(source).toMatch(/window/);
    expect(source).toMatch(/personId/);
    // Names the person rather than leaking a raw id.
    expect(source).toMatch(/displayName/);
  });

  it("update_followup_status supports every active transition through shared functions", () => {
    const source = readTool("update_followup_status");
    for (const fn of [
      "completeFollowup",
      "dismissFollowup",
      "snoozeFollowup",
      "reopenFollowup",
      "archiveFollowup",
    ]) {
      expect(source).toContain(fn);
    }
  });
});

describe("suggested follow-up tools are explicit-flow, grounded, and review-gated", () => {
  it("propose_followup requires grounding and supports the restricted opt-in", () => {
    const source = readTool("propose_followup");
    expect(source).toContain("suggestFollowup");
    expect(source).toMatch(/sourceRecordId/);
    expect(source).toMatch(/directlyRequested/);
    // It returns a tentative review component, not an active reminder.
    expect(source).toContain("component");
    expect(source).toMatch(/status:\s*result\.followup\.status/);
  });

  it("accept_suggested_followup promotes via the shared accept with an optional edit", () => {
    const source = readTool("accept_suggested_followup");
    expect(source).toContain("acceptSuggestedFollowup");
    expect(source).toMatch(/edit/);
  });

  it("dismiss_suggested_followup leaves review through the shared dismiss", () => {
    const source = readTool("dismiss_suggested_followup");
    expect(source).toContain("dismissSuggestedFollowup");
  });

  it("review tools return persisted ids and resolved person names", () => {
    for (const tool of ["list_suggested_followup_reviews", "get_suggested_followup_review"]) {
      const source = readTool(tool);
      expect(source).toContain("component");
      expect(source).toContain("displayName");
    }
  });
});

describe("Phase 1E follow-up tools stay inside the settled boundary", () => {
  const followupTools = toolFiles.filter((file) => /followup/.test(file));

  it("imports nothing from agenda, daily-brief, calendar, contacts, gmail, household, or draft/send modules", () => {
    // PRD #42 / AGENTS.md: Phase 1E follow-ups must not reach into relationship
    // agenda ranking, persisted briefs, or external/shared-household providers.
    // We check import specifiers (not prose) so a tool can still *disclaim* agenda
    // ranking in its description without tripping the guard.
    const forbiddenModule = /(agenda|brief|calendar|gmail|contacts|household|draft|outreach)/i;

    expect(followupTools.length).toBeGreaterThan(0);
    for (const file of followupTools) {
      const source = readTool(file.replace(/\.ts$/, ""));
      const importSpecifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
      for (const specifier of importSpecifiers) {
        expect(specifier).not.toMatch(forbiddenModule);
      }
    }
  });
});

describe("context-aware capture", () => {
  it("capture_source_record links a known person via the shared function and triggers extraction", () => {
    const source = readTool("capture_source_record");
    expect(source).toContain("captureSourceRecordForPerson");
    expect(source).toContain("enqueueAndTriggerExtractionJob");
    expect(source).toMatch(/personId/);
  });
});

describe("instructions steer capture vs save vs review", () => {
  it("distinguishes casual capture from explicit memory and disambiguation", () => {
    expect(instructions).toMatch(/capture_source_record/);
    expect(instructions).toMatch(/capture_memory/);
    expect(instructions).toMatch(/disambiguate/i);
    expect(instructions).toMatch(/[Nn]ever invent a durable fact/);
  });

  it("distinguishes exact recall, semantic recall, identity lookup, and person context", () => {
    expect(instructions).toMatch(/search_relationship_context/);
    expect(instructions).toMatch(/search_semantic_context/);
    expect(instructions).toMatch(/search_people/);
    expect(instructions).toMatch(/get_person_context/);
    expect(instructions).toMatch(/exact stored-context recall/i);
    expect(instructions).toMatch(/fuzzy stored-context recall/i);
    expect(instructions).toMatch(/meaning rather than exact wording/i);
  });

  it("keeps semantic recall separate from proactive agenda ranking", () => {
    expect(instructions).toMatch(/Do not use semantic retrieval/i);
    expect(instructions).toMatch(/who should I check in with/i);
    expect(instructions).toMatch(/get_relationship_agenda/i);
  });

  it("names the review tools and frames suggestions as tentative until approved", () => {
    expect(instructions).toMatch(/get_suggested_memory_review/);
    expect(instructions).toMatch(/approve_suggested_memory/);
    expect(instructions).toMatch(/dismiss_suggested_memory/);
    expect(instructions).toMatch(/tentative until the user approves/i);
  });

  it("steers 'what do I have to review' to the list tool so the cards render", () => {
    expect(instructions).toMatch(/list_suggested_memory_reviews/);
    // The plural review tool should win over describing suggestions in prose.
    expect(instructions).toMatch(/anything to review/i);
  });

  it("names the follow-up tools and gates creation on an explicit ask", () => {
    expect(instructions).toMatch(/create_followup/);
    expect(instructions).toMatch(/list_due_followups/);
    expect(instructions).toMatch(/update_followup_status/);
    // Eve must not invent active reminders.
    expect(instructions).toMatch(/only when the user explicitly asks/i);
    expect(instructions).toMatch(/[Nn]ever invent an active reminder/);
  });

  it("requires a concrete due date and clarification when timing is ambiguous", () => {
    expect(instructions).toMatch(/concrete due date/i);
    expect(instructions).toMatch(/ask a clarifying question/i);
  });

  it("keeps follow-up listing as due-date recall, not agenda ranking", () => {
    expect(instructions).toMatch(/not a "who should I check in with" agenda/i);
  });

  it("routes broad relationship horizon asks to the read-only agenda", () => {
    expect(instructions).toMatch(/get_relationship_agenda/);
    expect(instructions).toMatch(/broad relationship/i);
    expect(instructions).toMatch(/read-only agenda/i);
  });

  it("distinguishes suggested follow-ups from active reminders and gates proposing to explicit flows", () => {
    expect(instructions).toMatch(/propose_followup/);
    expect(instructions).toMatch(/list_suggested_followup_reviews/);
    expect(instructions).toMatch(/accept_suggested_followup/);
    expect(instructions).toMatch(/dismiss_suggested_followup/);
    expect(instructions).toMatch(/tentative proposal/i);
    expect(instructions).toMatch(/only in an explicit flow/i);
  });

  it("forbids background generation and cross-person agenda ranking of suggestions", () => {
    expect(instructions).toMatch(/[Nn]ever scan everyone and invent follow-ups/);
    expect(instructions).toMatch(/no background follow-up generation/i);
    expect(instructions).toMatch(/Do not use suggested-follow-up tools to propose reminders/i);
    expect(instructions).toMatch(/read-only `get_relationship_agenda` tool/i);
  });

  it("excludes restricted context from proactive suggestion unless directly requested", () => {
    expect(instructions).toMatch(/[Rr]estricted context is not used for proactive suggestions/);
    expect(instructions).toMatch(/directlyRequested/);
  });

  it("accepts or dismisses suggested follow-ups only on explicit user action", () => {
    expect(instructions).toMatch(/only on explicit user instruction or a card button action/i);
    expect(instructions).toMatch(/[Nn]ever accept or dismiss on the user's behalf/);
  });

  it("never surfaces raw record ids to the user", () => {
    expect(instructions).toMatch(/[Nn]ever show raw record ids/);
  });

  it("treats persisted ids, not conversation, as the source of truth", () => {
    expect(instructions).toMatch(/persisted record ids/i);
    expect(instructions).toMatch(/not the source of truth/i);
  });
});

describe("tools do not bypass owner scoping or scope/sensitivity rules", () => {
  // Tools that perform owner-scoped reads/writes (everything except the
  // owner-agnostic people search).
  const ownerScopedTools = toolFiles.filter((file) => file !== "search_people.ts");

  for (const file of ownerScopedTools) {
    it(`${file} resolves the owner via the shared helper instead of trusting input`, () => {
      const source = readFileSync(join(toolsDir, file), "utf8");
      expect(source).toContain("resolveOwnerUserId(ctx)");
      // Owner id is never accepted from tool input.
      expect(source).not.toMatch(/ownerUserId:\s*input\./);
    });
  }

  for (const file of toolFiles) {
    it(`${file} does not set a non-private scope (defers to the shared private default)`, () => {
      const source = readFileSync(join(toolsDir, file), "utf8");
      expect(source).not.toMatch(/scope:\s*["']?(shared|household)/);
    });
  }
});
