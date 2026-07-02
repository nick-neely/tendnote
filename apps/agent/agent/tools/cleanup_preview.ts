import { defineTool } from "eve/tools";
import { z } from "zod";
import { runCleanupPreviewSandbox } from "../lib/cleanup-preview-sandbox";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  inputText: z
    .string()
    .min(1)
    .describe(
      "Owner-supplied messy private input to preview. Paste CSV, vCard text, old notes, exported text, pasted lists, or JSON directly. Do not use Discord attachments.",
    ),
  inputKind: z
    .enum(["auto", "csv", "json", "text", "vcard"])
    .optional()
    .describe("Input format. Use auto unless the owner explicitly says the format."),
});

export default defineTool({
  description:
    "Parse owner-supplied messy private input in Cleanup Preview Mode and return normalized, deduped REVIEW-ONLY candidates. This tool never writes people, memories, contact methods, source records, follow-ups, drafts, or external data. Google Contacts import remains separate and Discord attachments are not accepted as input.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    return runCleanupPreviewSandbox({
      ownerUserId,
      inputText: input.inputText,
      inputKind: input.inputKind ?? "auto",
      source: "sandbox",
    });
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        previewId: output.id,
        inputKind: output.inputKind,
        totalCandidates: output.summary.totalCandidates,
        duplicateCandidates: output.summary.duplicateCandidates,
        byKind: output.summary.byKind,
        candidates: output.candidates.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          title: candidate.title,
          value: candidate.value,
          confidence: candidate.confidence,
          reviewOnly: candidate.reviewOnly,
          writesRequireExplicitConfirmation: candidate.writesRequireExplicitConfirmation,
        })),
        guidance:
          "Show this as a cleanup preview only. Do not claim anything was saved; durable writes require explicit Tendnote confirmation.",
      },
    };
  },
});
