import { vi } from "vitest";

/** External HTTP/Blob boundary for component tests; application upload logic stays real. */
export function mockFileUploadNetwork() {
  const id = "11111111-1111-4111-8111-111111111111";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/files" && options?.method === "POST")
        return Response.json({ id, pathname: `uploads/${id}` });
      if (url === `/api/files/${id}`)
        return Response.json({ id, fileName: "receipt.png", mimeType: "image/png", sizeBytes: 4 });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}
