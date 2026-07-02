import {
  type CreateCleanupPreviewInput,
  createCleanupPreview,
} from "@tendnote/db/queries/cleanup-preview";

/**
 * Cleanup Preview Mode runs owner-supplied messy private text through an isolated
 * app-owned entrypoint and returns review-only normalized candidates. Durable
 * people, memories, contact methods, source records, and follow-ups are not
 * written here; Tendnote confirmation surfaces must apply accepted candidates.
 */
export function runCleanupPreviewSandbox(input: CreateCleanupPreviewInput) {
  return createCleanupPreview({
    ...input,
    source: input.source ?? "sandbox",
  });
}
