import { beforeEach, expect, it, vi } from "vitest";
import { mockFileUploadNetwork } from "@/test/file-upload-network";
import { submitEvidenceForm } from "./upload";

vi.mock("@vercel/blob/client", () => ({ uploadPresigned: vi.fn(async () => ({})) }));
beforeEach(mockFileUploadNetwork);

it.each(["validation", "exception"])(
  "retires a temporary Asset upload after %s failure",
  async (failure) => {
    const form = new FormData();
    form.set("file", new File(["test"], "receipt.png", { type: "image/png" }));
    const submit = async () => {
      if (failure === "exception") throw new Error("Offline");
      return { ok: false };
    };
    if (failure === "exception")
      await expect(submitEvidenceForm(form, submit)).rejects.toThrow("Offline");
    else expect(await submitEvidenceForm(form, submit)).toEqual({ ok: false });
    expect(fetch).toHaveBeenCalledWith("/api/files/11111111-1111-4111-8111-111111111111", {
      method: "DELETE",
    });
  },
);

it("keeps an existing chat upload when saving it to an Asset fails", async () => {
  const form = new FormData();
  form.set("uploadedFileId", "chat-file");
  await submitEvidenceForm(form, async () => ({ ok: false }));
  expect(fetch).not.toHaveBeenCalled();
});
