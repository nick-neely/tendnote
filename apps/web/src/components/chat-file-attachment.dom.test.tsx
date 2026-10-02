// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";
import { ChatFileAttachment } from "./chat-file-attachment";

vi.mock("./assistant-evidence-capture", () => ({
  AssistantEvidenceCapture: ({ uploadedFileId }: { uploadedFileId: string }) => (
    <section aria-label="Save attachment">{uploadedFileId}</section>
  ),
}));
it("opens the authenticated file for an optional Asset save without reuploading it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"], { type: "image/png" }))),
  );
  render(<ChatFileAttachment id="owned-file" fileName="receipt.png" />);
  expect(screen.getByRole("link", { name: "receipt.png" }).getAttribute("href")).toBe(
    "/api/files/owned-file",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save to an Asset" }));
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Save attachment" }).textContent).toBe("owned-file"),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps an unavailable file out of the Asset save flow", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  render(<ChatFileAttachment id="gone" fileName="receipt.png" />);
  await userEvent.click(screen.getByRole("button", { name: "Save to an Asset" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not open"));
  expect(screen.queryByRole("region", { name: "Save attachment" })).toBeNull();
});

afterEach(() => {
  vi.unstubAllGlobals();
});
