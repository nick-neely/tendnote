// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const { loadMobileEveContextAction } = vi.hoisted(() => ({
  loadMobileEveContextAction: vi.fn(),
}));

vi.mock("@/app/actions/eve-context", () => ({ loadMobileEveContextAction }));
vi.mock("@/components/assistant-panel", () => ({
  AssistantPanel: () => <div>Conversation ready</div>,
}));

import { EveLauncher } from "./eve-launcher";

beforeEach(() => {
  vi.clearAllMocks();
  loadMobileEveContextAction.mockResolvedValue({ nudges: [], suggestPersonName: null });
});

it("keeps Eve context interaction-started and offers local retry after a failure", async () => {
  const user = userEvent.setup();
  render(<EveLauncher ownerUserId="owner-1" />);

  expect(loadMobileEveContextAction).not.toHaveBeenCalled();
  loadMobileEveContextAction.mockRejectedValueOnce(new Error("unavailable"));
  await user.click(screen.getByRole("button", { name: "Open Eve" }));

  expect(await screen.findByRole("heading", { name: "Eve is unavailable" })).toBeTruthy();
  expect(loadMobileEveContextAction).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Try Eve again" }));
  await waitFor(() => expect(loadMobileEveContextAction).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Conversation ready")).toBeTruthy();
});
