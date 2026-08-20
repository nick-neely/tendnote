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

  const now = new Date();
  const artifacts = createDrizzleOwnerDataExportArtifactStore();
  if (job.artifactExpiresAt <= now) {
    // Keep the response opaque, but durably expose failed deletion to the
    // recovery sweep: markExpired retains artifactExpiresAt until bytes are
    // physically gone.
    await jobs.markExpired({ jobId, now }).catch(() => undefined);
    try {
      await artifacts.delete({ jobId });
      await jobs.markArtifactDeleted({ jobId, now });
    } catch {
      // The retained expiry cursor makes this retryable by cron recovery.
    }
    return NextResponse.json(OPAQUE_NOT_FOUND, { status: 404 });
  }

  const artifact = await artifacts.get({
    jobId,
    ownerUserId,
    now,
  });
  if (!artifact) {
    // A pre-expiry miss may be a transient completion/object-store race. It
    // stays opaque without destroying the job's recoverable expiry cursor.
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
