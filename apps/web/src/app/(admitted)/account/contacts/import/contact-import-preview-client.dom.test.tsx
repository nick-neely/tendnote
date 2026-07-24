// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const { loadContactImportPreviewAction } = vi.hoisted(() => ({
  loadContactImportPreviewAction: vi.fn(),
}));

vi.mock("@/app/actions/contact-import", () => ({ loadContactImportPreviewAction }));
vi.mock("./contact-import-review", () => ({ ContactImportReview: () => null }));

import { ContactImportPreviewClient } from "./contact-import-preview-client";

beforeEach(() => {
  vi.clearAllMocks();
});

it("makes a failed provider-preview retry visibly single-flight", async () => {
  const user = userEvent.setup();
  loadContactImportPreviewAction.mockRejectedValueOnce(new Error("provider unavailable"));
  render(<ContactImportPreviewClient />);

  await user.click(screen.getByRole("button", { name: "Load preview" }));
  const retry = await screen.findByRole("button", { name: "Retry" });

  let resolvePreview: ((value: { connected: false }) => void) | undefined;
  loadContactImportPreviewAction.mockImplementationOnce(
    () =>
      new Promise<{ connected: false }>((resolve) => {
        resolvePreview = resolve;
      }),
  );
  await user.click(retry);

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveProperty("disabled", true);
  });
  resolvePreview?.({ connected: false });
});
