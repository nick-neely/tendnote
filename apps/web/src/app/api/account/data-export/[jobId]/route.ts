import {
  createDrizzleOwnerDataExportArtifactStore,
  createDrizzleOwnerDataExportJobStore,
} from "@tendnote/db/queries/owner-data-export";
import { NextResponse } from "next/server";
import { admittedOwnerOrNull } from "@/lib/access/current-access";

const OPAQUE_NOT_FOUND = { error: "Export unavailable." } as const;

/**
 * Download is an authorization boundary, not a capability URL. Every request
 * resolves the current admitted owner, reloads the job with that owner scope,
 * and asks the artifact store to enforce the same owner + expiry predicate.
 * Unknown artifacts and another owner's artifacts intentionally share one 404.
 */
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const ownerUserId = await admittedOwnerOrNull();
  const { jobId } = await context.params;
  if (!ownerUserId) return NextResponse.json(OPAQUE_NOT_FOUND, { status: 404 });

  const jobs = createDrizzleOwnerDataExportJobStore();
  const job = await jobs.get({ jobId, ownerUserId });
  if (job?.status !== "completed" || !job.artifactExpiresAt) {
    return NextResponse.json(OPAQUE_NOT_FOUND, { status: 404 });
  }

  const artifact = await createDrizzleOwnerDataExportArtifactStore().get({
    jobId,
    ownerUserId,
  });
  if (!artifact) {
    // Best effort terminal transition. The response stays opaque if the
    // artifact disappeared between the job and object-store reads.
    await jobs.markExpired({ jobId }).catch(() => undefined);
    return NextResponse.json(OPAQUE_NOT_FOUND, { status: 404 });
  }

  return new Response(Buffer.from(artifact.bytes), {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="tendnote-owner-export.zip"',
      "content-type": "application/zip",
      "content-length": String(artifact.bytes.byteLength),
      "x-content-type-options": "nosniff",
    },
  });
}
