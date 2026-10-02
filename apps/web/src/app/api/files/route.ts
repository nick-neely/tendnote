import { fileUploadService } from "@tendnote/db/queries/file-uploads";
import { z } from "zod";
import { admittedOwnerOrNull } from "@/lib/access/current-access";
import { getProductRateLimiter } from "@/lib/rate-limit";

const input = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.string().max(100),
  sizeBytes: z.number().int().positive(),
});
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return new Response(null, { status: 403 });
  const owner = await admittedOwnerOrNull();
  if (!owner) return new Response(null, { status: 401 });
  if (
    !(await getProductRateLimiter().check({ subject: owner, costCategory: "server-action" }))
      .allowed
  )
    return new Response(null, { status: 429 });
  try {
    const row = await fileUploadService.reserve(owner, input.parse(await request.json()));
    return Response.json({ id: row.id, pathname: row.pathname });
  } catch {
    return Response.json(
      { error: "Choose a supported image or PDF up to 10 MB." },
      { status: 400 },
    );
  }
}
