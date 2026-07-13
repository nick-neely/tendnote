import { getAssetEvidenceFile } from "@tendnote/db/queries/assets";
import { admittedOwnerOrNull } from "@/lib/access/current-access";

/**
 * The gated Asset Evidence file route (#200): serves stored upload bytes for
 * previews and downloads. Visibility is re-checked on every request through the
 * owner-scoped seam — the owner always, a household member exactly when the
 * evidence record's own scope reaches them. Every denial is the same 404, so a
 * hidden file and a missing one are indistinguishable — deterministic,
 * fail-closed denial, like every other scoped read in this app.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ evidenceId: string }> },
): Promise<Response> {
  const callerUserId = await admittedOwnerOrNull();
  if (!callerUserId) {
    return new Response("Not found", { status: 404 });
  }

  const { evidenceId } = await params;
  // Malformed ids fall through to the same deterministic 404.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(evidenceId)) {
    return new Response("Not found", { status: 404 });
  }

  const file = await getAssetEvidenceFile({ callerUserId, evidenceId });
  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      // Render inline (image previews, PDF tabs); the filename survives Save As.
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      // Private, per-user content — never cache at the edge.
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
