import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ owner: vi.fn(), authorize: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/access/current-access", () => ({ admittedOwnerOrNull: mocks.owner }));
vi.mock("@tendnote/db/queries/file-uploads", () => ({
  fileUploadService: { authorize: mocks.authorize },
}));
vi.mock("@vercel/blob", () => ({ issueSignedToken: mocks.sign }));

import { POST } from "./route";

const pathname = "uploads/owned-file";
function request(origin = "http://localhost", clientPayload: string | null = "owned-file") {
  return new Request("http://localhost/api/files/upload", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-presigned-url",
      payload: { pathname, clientPayload, multipart: false },
    }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BLOB_WEBHOOK_PUBLIC_KEY", "test-webhook-public-key");
  vi.stubEnv("VERCEL_BLOB_CALLBACK_URL", "https://app.example/api/files/upload");
  mocks.owner.mockResolvedValue("owner");
  mocks.authorize.mockResolvedValue({ pathname, mimeType: "image/png", sizeBytes: 8 });
  mocks.sign.mockImplementation(async (scope) => ({
    delegationToken: `${Buffer.from(JSON.stringify(scope)).toString("base64url")}.test-signature`,
    clientSigningToken: "server-only",
    validUntil: scope.validUntil,
  }));
});

afterEach(() => vi.unstubAllEnvs());

it("rejects cross-origin requests before accessing an account or signing", async () => {
  expect((await POST(request("https://foreign.example"))).status).toBe(400);
  expect(mocks.owner).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});

it("requires an admitted owner and reservation before signing", async () => {
  mocks.owner.mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(400);
  expect((await POST(request("http://localhost", null))).status).toBe(400);
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});

it("refuses another owner's, completed, expired, or mismatched reservation", async () => {
  mocks.authorize.mockRejectedValue(new Error("File unavailable"));
  expect((await POST(request())).status).toBe(400);
  expect(mocks.authorize).toHaveBeenCalledWith("owner", "owned-file", pathname);
  expect(mocks.sign).not.toHaveBeenCalled();
});

it("delegates only a five-minute bounded write to the authorized path", async () => {
  const before = Date.now();
  const response = await POST(request());
  expect(response.status).toBe(200);
  const constraints = mocks.sign.mock.calls[0]?.[0];
  expect(constraints).toEqual({
    pathname,
    operations: ["put"],
    allowedContentTypes: ["image/png"],
    maximumSizeInBytes: 8,
    validUntil: expect.any(Number),
  });
  expect(constraints.validUntil).toBeGreaterThanOrEqual(before + 5 * 60_000);
  expect(constraints.validUntil).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  const body = await response.json();
  expect(body.type).toBe("blob.generate-presigned-url");
  expect(body.presignedUrlPayload.signature).toEqual(expect.any(String));
  expect(body.presignedUrlPayload.params).toMatchObject({
    "vercel-blob-allowed-content-types": "image/png",
    "vercel-blob-maximum-size-in-bytes": "8",
    "vercel-blob-add-random-suffix": "false",
    "vercel-blob-allow-overwrite": "false",
  });
  expect(JSON.stringify(body)).not.toContain("server-only");
});

it("refuses unsigned completion callbacks without signing a new upload", async () => {
  const response = await POST(
    new Request("http://localhost/api/files/upload", {
      method: "POST",
      body: JSON.stringify({ type: "blob.upload-completed", payload: {} }),
    }),
  );
  expect(response.status).toBe(400);
  expect(mocks.owner).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});

it("fails closed when OIDC signing fails without exposing provider errors", async () => {
  mocks.sign.mockRejectedValue(new Error("expired credential"));
  const response = await POST(request());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Upload unavailable. Try attaching the file again.",
  });
});
