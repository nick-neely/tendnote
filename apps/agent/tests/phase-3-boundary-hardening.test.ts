import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listEveModeDefinitions,
  modeAllowsCapability,
  modeAllowsTool,
} from "../agent/lib/eve-modes";
import { effectiveToolSource } from "./tool-source";

const repoRoot = join(import.meta.dirname, "../../..");

const PHASE_3_IMPLEMENTATION_FILES = [
  "apps/agent/agent/channels/discord.ts",
  "apps/agent/agent/lib/cleanup-preview-sandbox.ts",
  "apps/agent/agent/lib/eve-modes.ts",
  "apps/agent/agent/schedules/brief-dispatcher.ts",
  "apps/agent/agent/subagents/memory_curator/agent.ts",
  "apps/agent/agent/subagents/memory_curator/tools/propose_memory_cleanup.ts",
  "apps/agent/agent/subagents/message_drafter/agent.ts",
  "apps/agent/agent/subagents/message_drafter/tools/propose_message_draft.ts",
  "apps/agent/agent/subagents/relationship_strategist/agent.ts",
  "apps/agent/agent/subagents/relationship_strategist/tools/get_relationship_agenda.ts",
  "apps/agent/agent/subagents/relationship_strategist/tools/list_calendar_events.ts",
  "apps/agent/agent/subagents/relationship_strategist/tools/list_message_drafts.ts",
  "apps/agent/agent/subagents/relationship_strategist/tools/propose_followup.ts",
  "apps/agent/agent/subagents/relationship_strategist/tools/search_people.ts",
  "apps/agent/agent/tools/cleanup_preview.ts",
  "packages/db/src/queries/birthday-gift-planning.ts",
  "packages/db/src/queries/brief-schedules.ts",
  "packages/db/src/queries/cleanup-preview.ts",
  "packages/db/src/queries/draft-proposals.ts",
  "packages/db/src/queries/memory-curator.ts",
  "packages/db/src/queries/morning-agenda.ts",
  "packages/db/src/queries/post-meeting-aftercare.ts",
  "packages/db/src/queries/scheduled-workflow-deliveries.ts",
  "packages/db/src/queries/scheduled-workflow-deliveries/drizzle-store.ts",
  "packages/db/src/queries/scheduled-workflow-deliveries/index.ts",
  "packages/db/src/queries/scheduled-workflow-deliveries/service.ts",
  "packages/db/src/queries/scheduled-workflow-deliveries/types.ts",
  "packages/db/src/queries/weekly-relationship-review.ts",
] as const;

const CLEANUP_PREVIEW_FILES = [
  "apps/agent/agent/lib/cleanup-preview-sandbox.ts",
  "apps/agent/agent/tools/cleanup_preview.ts",
  "packages/db/src/queries/cleanup-preview.ts",
] as const;

const SCHEDULED_WORKFLOW_FILES = [
  "apps/agent/agent/schedules/brief-dispatcher.ts",
  "packages/db/src/queries/birthday-gift-planning.ts",
  "packages/db/src/queries/brief-schedules.ts",
  "packages/db/src/queries/morning-agenda.ts",
  "packages/db/src/queries/post-meeting-aftercare.ts",
  "packages/db/src/queries/weekly-relationship-review.ts",
] as const;

function read(relativePath: string): string {
  const fullPath = join(repoRoot, relativePath);
  expect(existsSync(fullPath), `${relativePath} should exist`).toBe(true);
  return readFileSync(fullPath, "utf8");
}

function listFiles(root: string): string[] {
  return readdirSync(join(repoRoot, root)).flatMap((entry) => {
    const fullPath = join(repoRoot, root, entry);
    const rel = relative(repoRoot, fullPath);
    if (entry === "node_modules") return [];
    if (statSync(fullPath).isDirectory()) return listFiles(rel);
    return [rel];
  });
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/from\s+["']([^"']+)["']/g),
    ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/export\s+[^;]*\s+from\s+["']([^"']+)["']/g),
    ...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1] ?? "");
}

function normalizedSource(files: readonly string[]): string {
  return files
    .map((file) => read(file))
    .join("\n")
    .toLowerCase();
}

describe("Phase 3 boundary hardening", () => {
  it("pins the Phase 3 implementation surfaces covered by these policy scans", () => {
    const currentPhase3Files = [
      ...listFiles("apps/agent/agent")
        .filter((file) =>
          /channels\/discord|lib\/cleanup-preview-sandbox|lib\/eve-modes|schedules\/brief-dispatcher|subagents\/(memory_curator|message_drafter|relationship_strategist)\/|tools\/cleanup_preview/.test(
            file,
          ),
        )
        // Each subagent's `instructions/` slot is prose plus its date anchor, not a
        // policy surface these scans read; the per-subagent tests own it.
        .filter((file) => !/\/instructions\//.test(file))
        // A file that only exports disableTool() turns off an Eve framework
        // default. It implements nothing, so it is not a surface these scans
        // have anything to say about; the active-tree lockdown test pins it.
        .filter((file) => !/export default disableTool\(\)/.test(read(file))),
      ...listFiles("packages/db/src/queries").filter(
        (file) =>
          !/\.test\.ts$/.test(file) &&
          !/in-memory-store\.ts$/.test(file) &&
          /birthday-gift-planning|brief-schedules\.ts|cleanup-preview|draft-proposals|memory-curator|morning-agenda|post-meeting-aftercare|scheduled-workflow-deliveries|weekly-relationship-review/.test(
            file,
          ),
      ),
    ].sort();

    expect(currentPhase3Files).toEqual([...PHASE_3_IMPLEMENTATION_FILES].sort());
  });

  it("does not add generic Eve MCP/OpenAPI, shared-context, or privacy-guard behavior", () => {
    const source = normalizedSource(PHASE_3_IMPLEMENTATION_FILES);

    for (const forbidden of [
      "modelcontextprotocol",
      "openapi",
      "swagger",
      "shared_context",
      "shared context",
      "privacy_guard",
      "privacy guard",
    ]) {
      expect(source, `Phase 3 implementation should not contain ${forbidden}`).not.toContain(
        forbidden,
      );
    }

    for (const relativePath of PHASE_3_IMPLEMENTATION_FILES) {
      const imports = importSpecifiers(read(relativePath)).join("\n").toLowerCase();
      expect(imports, `${relativePath} imports`).not.toMatch(/\bmcp\b|openapi|swagger/);
    }
  });

  it("keeps external sends and autonomous external draft creation out of Phase 3 surfaces", () => {
    const source = normalizedSource(PHASE_3_IMPLEMENTATION_FILES);

    for (const forbidden of [
      "save_draft_to_gmail",
      "gmail-drafts",
      "gmail/send",
      "messages/send",
      "drafts/send",
      "nodemailer",
      "sendgrid",
      "mailgun",
      "resend",
      "twilio",
      "slack",
      "telegram",
      "transporter.send",
    ]) {
      expect(source, `Phase 3 implementation should not contain ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("keeps Cleanup Preview separate from Google Contacts and Discord attachment import", () => {
    const source = normalizedSource(CLEANUP_PREVIEW_FILES);
    const imports = CLEANUP_PREVIEW_FILES.flatMap((file) => importSpecifiers(read(file)));

    expect(imports.join("\n")).not.toContain("contacts-import-preview");
    expect(imports.join("\n")).not.toContain("channels/discord");
    expect(source).not.toContain("people.googleapis");
    expect(source).not.toContain("discord_attachment:");
    expect(source).toContain("discord attachments are not a cleanup preview input path");

    expect(modeAllowsTool("cleanup_preview", "cleanup_preview")).toBe(true);
    expect(modeAllowsTool("cleanup_preview", "capture_source_record")).toBe(false);
    expect(modeAllowsTool("cleanup_preview", "propose_followup")).toBe(false);
    expect(modeAllowsTool("cleanup_preview", "create_message_draft")).toBe(false);
  });

  it("keeps specialist and scheduled surfaces behind proposal/review boundaries", () => {
    expect(modeAllowsTool("scheduled_workflow", "create_message_draft")).toBe(false);
    expect(modeAllowsCapability("scheduled_workflow", "persist_draft_with_intent")).toBe(false);

    const scheduledSource = normalizedSource(SCHEDULED_WORKFLOW_FILES);
    expect(scheduledSource).not.toContain("createDraft(");
    expect(scheduledSource).not.toContain("persistAcceptedDraftProposal");
    expect(scheduledSource).not.toContain("save_draft_to_gmail");

    const curatorSource = read("packages/db/src/queries/memory-curator.ts");
    expect(curatorSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(curatorSource).not.toContain("approveSuggestedMemory");

    // The registration plus the shared definition it registers: the strategist's
    // copy of this tool is gone, so the boundary now has to hold in the file both
    // agents share.
    const strategistTool = effectiveToolSource(
      join(
        repoRoot,
        "apps/agent/agent/subagents/relationship_strategist/tools/propose_followup.ts",
      ),
    );
    expect(strategistTool).toContain("@tendnote/db/queries/followups");
    expect(strategistTool).toContain("suggestFollowup");
    expect(strategistTool).not.toContain("createFollowup");
    expect(strategistTool).not.toContain("acceptSuggestedFollowup");

    const drafterTool = read(
      "apps/agent/agent/subagents/message_drafter/tools/propose_message_draft.ts",
    );
    const drafterImports = importSpecifiers(drafterTool).join("\n");
    expect(drafterTool).toContain("@tendnote/db/queries/draft-proposals");
    expect(drafterTool).toContain("proposeDraft");
    expect(drafterImports).not.toContain("@tendnote/db/queries/drafts");
    expect(drafterTool).not.toContain("persistAcceptedDraftProposal");
  });

  it("keeps Phase 3 Eve modes explicit and narrow", () => {
    expect(
      listEveModeDefinitions()
        .map((definition) => definition.mode)
        .sort(),
    ).toEqual([
      "cleanup_preview",
      "discord_capture",
      "drafting",
      "scheduled_workflow",
      "selected_person",
    ]);
  });
});
