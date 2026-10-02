import { fileUploadService } from "@tendnote/db/queries/file-uploads";
import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { admittedOwnerOrNull } from "@/lib/access/current-access";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      async onBeforeGenerateToken(pathname, clientPayload) {
        if (request.headers.get("origin") !== new URL(request.url).origin)
          throw new Error("Unauthorized");
        const owner = await admittedOwnerOrNull();
        if (!owner || !clientPayload) throw new Error("Unauthorized");
        const row = await fileUploadService.authorize(owner, clientPayload, pathname);
        return {
          allowedContentTypes: [row.mimeType],
          maximumSizeInBytes: row.sizeBytes,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 5 * 60_000,
        };
      },
      // Browser completion re-reads the private object and validates its signature.
      async onUploadCompleted() {},
    });
    return Response.json(result);
  } catch {
    return Response.json(
      { error: "Upload unavailable. Try attaching the file again." },
      { status: 400 },
    );
  }
}
