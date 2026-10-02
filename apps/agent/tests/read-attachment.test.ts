import { beforeEach, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const { read, getEvidence, generateText, hostedModel, markConversationTainted } = vi.hoisted(
  () => ({
    markConversationTainted: vi.fn(),
    read: vi.fn(),
    getEvidence: vi.fn(),
    generateText: vi.fn(),
    hostedModel: vi.fn(() => ({})),
  }),
);
vi.mock("@tendnote/db/queries/file-uploads", () => ({ fileUploadService: { read } }));
vi.mock("@tendnote/db/queries/assets", () => ({ getAssetEvidenceFile: getEvidence }));
vi.mock("@tendnote/db/queries/model-calls", () => ({ hostedModel }));
vi.mock("ai", () => ({ generateText }));
vi.mock("../agent/lib/conversation-taint", () => ({ markConversationTainted }));
const { default: raw } = await import("../agent/tools/read_attachment");
const tool = asTestTool(raw);
const ctx = { session: { auth: { current: { principalId: "alice" } } } } as never;
const fileId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => vi.clearAllMocks());
it("cannot read an unavailable upload or send its bytes to a model", async () => {
  read.mockResolvedValue(null);
  expect(
    await tool.execute({ fileId, source: "chat", question: "What does this say?" }, ctx),
  ).toMatchObject({ found: false });
  expect(read).toHaveBeenCalledWith("alice", fileId);
  expect(generateText).not.toHaveBeenCalled();
});
it("reads the authorized source and returns grounded text without retaining file bytes in its output", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  read.mockResolvedValue({ fileName: "receipt.pdf", mimeType: "application/pdf", bytes });
  generateText.mockResolvedValue({ text: "The total is $42.00 on page 1." });
  const result = await tool.execute(
    { fileId, source: "chat", question: "What is the total?" },
    ctx,
  );
  expect(result).toMatchObject({
    readable: true,
    fileName: "receipt.pdf",
    answer: "The total is $42.00 on page 1.",
  });
  expect(result).not.toHaveProperty("bytes");
  expect(markConversationTainted).toHaveBeenCalledWith("read_attachment");
  expect(markConversationTainted).toHaveBeenCalledBefore(generateText);
  expect(generateText.mock.calls[0]?.[0].messages[0].content[1]).toMatchObject({
    data: bytes,
    mediaType: "application/pdf",
  });
});
it("uses the household visibility gate for Asset evidence", async () => {
  getEvidence.mockResolvedValue(null);
  expect(
    await tool.execute({ fileId, source: "asset", question: "Read the warranty" }, ctx),
  ).toMatchObject({ found: false });
  expect(getEvidence).toHaveBeenCalledWith({ callerUserId: "alice", evidenceId: fileId });
  expect(read).not.toHaveBeenCalled();
});

it("returns a safe unreadable result when the provider rejects the document", async () => {
  read.mockResolvedValue({
    fileName: "receipt.pdf",
    mimeType: "application/pdf",
    bytes: new Uint8Array([1]),
  });
  generateText.mockRejectedValue(new Error("Provider request body: private-document-content"));
  const result = await tool.execute({ fileId, source: "chat", question: "Read it" }, ctx);
  expect(result).toMatchObject({ found: true, readable: false });
  expect(JSON.stringify(result)).not.toContain("private-document-content");
});
it("preserves cancellation instead of returning a reading failure", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Cancelled"));
  read.mockResolvedValue({
    fileName: "receipt.pdf",
    mimeType: "application/pdf",
    bytes: new Uint8Array([1]),
  });
  generateText.mockRejectedValue(new Error("Provider failure"));
  await expect(
    tool.execute({ fileId, source: "chat", question: "Read it" }, {
      session: { auth: { current: { principalId: "alice" } } },
      abortSignal: controller.signal,
    } as never),
  ).rejects.toThrow("Cancelled");
});
it("does not send unsupported HEIC bytes to the model", async () => {
  read.mockResolvedValue({
    fileName: "photo.heic",
    mimeType: "image/heic",
    bytes: new Uint8Array([1]),
  });
  expect(await tool.execute({ fileId, source: "chat", question: "Read it" }, ctx)).toMatchObject({
    found: true,
    readable: false,
  });
  expect(generateText).not.toHaveBeenCalled();
});
