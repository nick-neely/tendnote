import { fileUploadService } from "@tendnote/db/queries/file-uploads";
import { admittedOwnerOrNull } from "@/lib/access/current-access";

type Context = { params: Promise<{ fileId: string }> };
async function identity(context: Context) {
  const owner = await admittedOwnerOrNull();
  const { fileId } = await context.params;
  return owner && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(fileId)
    ? { owner, fileId }
    : null;
}
export async function GET(_request: Request, context: Context) {
  const who = await identity(context);
  if (!who) return new Response(null, { status: 404 });
  const file = await fileUploadService.read(who.owner, who.fileId);
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function POST(request: Request, context: Context) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return new Response(null, { status: 403 });
  const who = await identity(context);
  if (!who) return new Response(null, { status: 404 });
  try {
    return Response.json(await fileUploadService.complete(who.owner, who.fileId));
  } catch {
    return Response.json(
      { error: "This file could not be verified. Attach it again." },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request, context: Context) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return new Response(null, { status: 403 });
  const who = await identity(context);
  if (!who) return new Response(null, { status: 404 });
  await fileUploadService.remove(who.owner, who.fileId);
  return new Response(null, { status: 204 });
}
