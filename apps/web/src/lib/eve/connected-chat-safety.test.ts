import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toAssistantToolView } from "./tool-result-view";

function readTsFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return readTsFilesRecursive(full);
    }
    // Scan application source only; test files legitimately name these patterns.
    if (entry.includes(".test.")) {
      return [];
    }
    return entry.endsWith(".ts") || entry.endsWith(".tsx") ? [readFileSync(full, "utf8")] : [];
  });
}

// The whole web→Eve surface, globbed so a send path added in a new file is still
// covered. External send / draft creation must not appear anywhere in it.
const webChatSurface = [
  ...readTsFilesRecursive(join(process.cwd(), "src/lib/eve")),
  readFileSync(join(process.cwd(), "src/app/actions/assistant.ts"), "utf8"),
];

const externalSendPatterns =
  /gmail|nodemailer|\bsmtp\b|sendEmail|sendMail|createDraft|create_draft|outlook|twilio/i;

describe("connected web chat cannot send or draft externally (Phase 1B.5)", () => {
  it("the whole web→Eve bridge surface contains no external send or draft path", () => {
    for (const source of webChatSurface) {
      expect(externalSendPatterns.test(source)).toBe(false);
    }
  });
});

describe("connected web chat render layer cannot restate tentative context as fact", () => {
  it("renders logged context (a casual note) as a source record, never a confirmed memory", () => {
    const view = toAssistantToolView({
      toolName: "capture_source_record",
      output: {
        sourceRecord: { id: "source-1", content: "Had lunch with Mark." },
        linkedPersonId: "person-1",
      },
    });

    expect(view.kind).toBe("saved_source_record");
    expect(view.kind).not.toBe("saved_memory");
  });

  it("renders a suggested memory as a tentative review item, never a confirmed memory", () => {
    const view = toAssistantToolView({
      toolName: "get_suggested_memory_review",
      output: {
        found: true,
        memory: { id: "memory-2", content: "Maybe switching jobs.", sourceRecordId: "source-2" },
      },
    });

    expect(view.kind).toBe("suggested_memory_review");
    expect(view.kind).not.toBe("saved_memory");
  });

  it("only an approved-memory capture produces the confirmed-fact view", () => {
    const view = toAssistantToolView({
      toolName: "capture_memory",
      output: {
        memory: { id: "memory-1", content: "Caleb moved to Denver.", sourceRecordId: "source-1" },
        person: { id: "person-1", displayName: "Caleb" },
      },
    });

    expect(view.kind).toBe("saved_memory");
  });
});
