import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  rate: vi.fn(),
  reserve: vi.fn(),
  read: vi.fn(),
  complete: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/access/current-access", () => ({ admittedOwnerOrNull: mocks.owner }));
vi.mock("@/lib/rate-limit", () => ({ getProductRateLimiter: () => ({ check: mocks.rate }) }));
vi.mock("@tendnote/db/queries/file-uploads", () => ({ fileUploadService: mocks }));

import { POST as complete, DELETE, GET } from "./[fileId]/route";
import { POST as reserve } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ fileId: id }) };
const file = { fileName: "photo.png", mimeType: "image/png", sizeBytes: 8 };
function request(method: string, origin = "http://localhost") {
  return new Request(`http://localhost/api/files/${id}`, {
    method,
    headers: { origin, "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(file) } : {}),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.owner.mockResolvedValue("owner");
  mocks.rate.mockResolvedValue({ allowed: true });
});
it("rejects cross-origin mutations before touching storage", async () => {
  for (const action of [reserve, complete, DELETE]) {
    expect((await action(request("POST", "https://foreign.example"), context)).status).toBe(403);
  }
  expect(mocks.owner).not.toHaveBeenCalled();
});
it("requires an admitted account and rate allowance to reserve", async () => {
  mocks.owner.mockResolvedValueOnce(null);
  expect((await reserve(request("POST"))).status).toBe(401);
  mocks.rate.mockResolvedValueOnce({ allowed: false });
  expect((await reserve(request("POST"))).status).toBe(429);
  expect(mocks.reserve).not.toHaveBeenCalled();
});
it("returns only the server-selected upload reservation", async () => {
  mocks.reserve.mockResolvedValue({ id, pathname: `uploads/${id}`, ownerUserId: "owner" });
  const response = await reserve(request("POST"));
  expect(await response.json()).toEqual({ id, pathname: `uploads/${id}` });
  expect(mocks.reserve).toHaveBeenCalledWith("owner", file);
});
it("serves owned bytes privately with safe content headers", async () => {
  mocks.read.mockResolvedValue({ ...file, bytes: new Uint8Array([1, 2, 3]) });
  const response = await GET(request("GET"), context);
  expect(mocks.read).toHaveBeenCalledWith("owner", id);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});
it("does not distinguish absent and unauthorized files", async () => {
  mocks.owner.mockResolvedValueOnce(null);
  expect((await GET(request("GET"), context)).status).toBe(404);
  expect(mocks.read).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue(null);
  expect((await GET(request("GET"), context)).status).toBe(404);
});
it("binds completion and deletion to the authenticated owner", async () => {
  mocks.complete.mockResolvedValue({ id, ...file });
  expect((await complete(request("POST"), context)).status).toBe(200);
  expect(mocks.complete).toHaveBeenCalledWith("owner", id);
  expect((await DELETE(request("DELETE"), context)).status).toBe(204);
  expect(mocks.remove).toHaveBeenCalledWith("owner", id);
});
