import { fileUploadService } from "@tendnote/db/queries/file-uploads";
import { issueSignedToken } from "@vercel/blob";
import { type HandleUploadPresignedBody, handleUploadPresigned } from "@vercel/blob/client";
import { admittedOwnerOrNull } from "@/lib/access/current-access";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadPresignedBody;
    const result = await handleUploadPresigned({
      request,
      body,
      async getSignedToken(pathname, clientPayload) {
        if (request.headers.get("origin") !== new URL(request.url).origin)
          throw new Error("Unauthorized");
        const owner = await admittedOwnerOrNull();
        if (!owner || !clientPayload) throw new Error("Unauthorized");
        const row = await fileUploadService.authorize(owner, clientPayload, pathname);
        const constraints = {
          allowedContentTypes: [row.mimeType],
          maximumSizeInBytes: row.sizeBytes,
          validUntil: Date.now() + 5 * 60_000,
        };
        return {
          token: await issueSignedToken({
            ...constraints,
            pathname: row.pathname,
            operations: ["put"],
          }),
          urlOptions: {
            ...constraints,
            addRandomSuffix: false,
            allowOverwrite: false,
          },
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
