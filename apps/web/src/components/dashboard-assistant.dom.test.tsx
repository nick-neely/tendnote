// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, setMatchMedia, waitFor } from "@/test/dom";

const { mounted } = vi.hoisted(() => ({ mounted: vi.fn() }));

// The column claims its Eve session as a listable thread (ADR 0238), which puts
// the server-action module in this client component's import graph. Vitest
// resolves it for real, `server-only` and all, so it stands aside here.
vi.mock("@/app/actions/assistant-conversations", () => ({
  recordAssistantConversationAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/components/assistant-panel", () => ({
  AssistantPanel: ({ suggestPersonName }: { suggestPersonName: string | null }) => {
    mounted();
    return (
      <div>
        <textarea aria-label="Ask the assistant" />
        <p>{suggestPersonName ?? "no suggestion"}</p>
      </div>
    );
  },
}));

import { DashboardAssistant } from "./dashboard-assistant";
import { DashboardAssistantReserve } from "./dashboard-reserve";

beforeEach(() => {
  mounted.mockClear();
  // The dashboard column only exists at `lg` and up.
  setMatchMedia(true);
});

/**
 * The dashboard's whole job is capture, so the composer must be reachable without
 * a preliminary click. The privacy contract it used to gate — no owner
 * conversation, provider call, or draft before explicit interaction (ADR 0208,
 * #308) — is held by the agent client, not by hiding the surface.
 */
it("puts the composer on screen with no gate to open first", async () => {
  render(
    <DashboardAssistant nudges={[]} ownerUserId="owner-1" suggestPersonName="Jordan Rivera" />,
  );

  expect(screen.queryByRole("button", { name: /open eve/i })).toBeNull();
  expect(await screen.findByRole("textbox", { name: "Ask the assistant" })).toBeDefined();
  await waitFor(() => expect(screen.getByText("Jordan Rivera")).toBeDefined());
});

/**
 * `hidden lg:contents` hides this column on a phone but React still mounts it. A
 * second panel mounted out of sight would read the on-device composer draft and consume
 * the one-shot "send this draft" handoff the mobile Today band writes — sending a
 * turn into a tree the owner cannot see. The panel mounts only where it is the
 * assistant.
 */
it("never mounts the panel on a viewport where the column is hidden", async () => {
  setMatchMedia(false);
  render(<DashboardAssistant nudges={[]} ownerUserId="owner-1" suggestPersonName={null} />);

  expect(screen.getByRole("region", { name: "Loading the assistant" })).toBeDefined();
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Ask the assistant" })).toBeNull(),
  );
  expect(mounted).not.toHaveBeenCalled();
});

/**
 * The reserve stands in for the panel for as long as the owner scope and the
 * panel's own chunk take to arrive, so it renders the panel's real chrome rather
 * than a hand-matched copy that would drift and shift.
 */
it("reserves the assistant with the panel's own copy, not a generic skeleton", () => {
  render(<DashboardAssistantReserve />);

  const reserve = screen.getByRole("region", { name: "Loading the assistant" });
  expect(reserve.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByRole("heading", { name: "Assistant" })).toBeDefined();
  expect(screen.getByText(/nothing is saved without your review/i)).toBeDefined();
  expect(screen.getByText("What do you want to remember?")).toBeDefined();
  expect(screen.getByText("Private")).toBeDefined();
});
