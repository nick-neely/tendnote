import { describe, expect, it } from "vitest";
import {
  listEveModeDefinitions,
  modeAllowsCapability,
  modeAllowsTool,
  resolveEveMode,
} from "../agent/lib/eve-modes";

describe("Phase 3 Eve modes foundation", () => {
  it("resolves the five private Eve modes from caller, channel, person, and workflow context", () => {
    expect(resolveEveMode({ caller: "discord", channel: "discord" }).mode).toBe("discord_capture");
    expect(
      resolveEveMode({ caller: "web", channel: "web", selectedPersonId: "person_1" }).mode,
    ).toBe("selected_person");
    expect(resolveEveMode({ caller: "web", channel: "web", requestedTask: "draft" }).mode).toBe(
      "drafting",
    );
    expect(
      resolveEveMode({ caller: "schedule", channel: "schedule", workflow: "morning_agenda" }).mode,
    ).toBe("scheduled_workflow");
    expect(
      resolveEveMode({ caller: "sandbox", channel: "sandbox", workflow: "cleanup_preview" }).mode,
    ).toBe("cleanup_preview");
  });

  it("declares all Phase 3 modes with explicit tool and skill surfaces", () => {
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

  it("keeps out-of-mode mutation capabilities unavailable", () => {
    expect(modeAllowsTool("drafting", "approve_suggested_memory")).toBe(false);
    expect(modeAllowsCapability("drafting", "memory_cleanup_proposal")).toBe(false);

    expect(modeAllowsTool("cleanup_preview", "capture_source_record")).toBe(false);
    expect(modeAllowsTool("cleanup_preview", "create_message_draft")).toBe(false);
    expect(modeAllowsTool("cleanup_preview", "cleanup_preview")).toBe(true);
    expect(modeAllowsCapability("cleanup_preview", "persist_draft_with_intent")).toBe(false);

    expect(modeAllowsTool("scheduled_workflow", "create_message_draft")).toBe(false);
    expect(modeAllowsCapability("scheduled_workflow", "persist_draft_with_intent")).toBe(false);
  });

  it("keeps Discord capture narrow and review-oriented", () => {
    expect(modeAllowsTool("discord_capture", "capture_source_record")).toBe(true);
    expect(modeAllowsTool("discord_capture", "create_message_draft")).toBe(false);
    expect(modeAllowsTool("discord_capture", "propose_followup")).toBe(false);
    expect(modeAllowsCapability("discord_capture", "capture_source_record")).toBe(true);
  });
});
