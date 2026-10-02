import { expect, it } from "vitest";
import { attachmentMessage, splitAttachmentMessage } from "./message";

it("keeps a question and its attachment together through chat and replay", () => {
  const text = attachmentMessage("What is the warranty?", {
    id: "11111111-1111-4111-8111-111111111111",
    fileName: "receipt.png",
  });
  expect(splitAttachmentMessage(text)).toEqual({
    text: "What is the warranty?",
    file: { id: "11111111-1111-4111-8111-111111111111", fileName: "receipt.png" },
  });
});
