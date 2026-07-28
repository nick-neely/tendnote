// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";

const { captureGlobalAssistantSourceRecord } = vi.hoisted(() => ({
  captureGlobalAssistantSourceRecord: vi.fn(),
}));

vi.mock("@/app/actions/source-records", () => ({
  captureGlobalAssistantSourceRecord,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PersonCapture } from "./person-capture";

it("shows a curated extraction-budget failure to the owner", async () => {
  captureGlobalAssistantSourceRecord.mockResolvedValue({
    ok: false,
    error: "You've reached a usage limit for this action. Please try again shortly.",
  });
  const user = userEvent.setup();
  render(<PersonCapture firstName="Maya" personId="person-1" personName="Maya Chen" />);

  await user.type(screen.getByRole("textbox", { name: "Add a note about Maya Chen" }), "A note");
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "You've reached a usage limit for this action. Please try again shortly.",
  );
});
