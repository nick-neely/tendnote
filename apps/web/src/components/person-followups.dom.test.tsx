// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { FollowupView } from "@/lib/followup-view";
import { render, screen, waitFor } from "@/test/dom";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/person-followup-active-row", () => ({
  ActiveFollowupRow: ({ followup }: { followup: FollowupView }) => (
    <div data-testid={`active-${followup.id}`}>{followup.surfaceLabel}</div>
  ),
}));

vi.mock("@/components/person-followup-resolved-row", () => ({
  ResolvedFollowupRow: ({ followup }: { followup: FollowupView }) => (
    <div data-testid={`resolved-${followup.id}`}>{followup.surfaceLabel}</div>
  ),
}));

vi.mock("@/components/person-followup-create-form", () => ({
  CreateFollowupForm: () => null,
}));

import { PersonFollowups } from "./person-followups";

function followup(
  id: string,
  revision: string,
  surfaceLabel: string,
  status: FollowupView["status"] = "open",
): FollowupView {
  return {
    id,
    revision,
    reason: "Check in.",
    status,
    ownerUserId: "owner-1",
    owned: true,
    dueAtISO: "2026-07-15T00:00:00.000Z",
    dueAtDate: "2026-07-15",
    dueLabel: "Jul 15",
    dueState: "upcoming",
    surfaceLabel,
    visibilityChoice: "only_me",
    visibilityLabel: "Only me",
  };
}

describe("PersonFollowups server reconciliation", () => {
  it("adopts newer active and resolved projections for existing ids", async () => {
    const props = {
      defaultDueDate: "2026-07-15",
      firstName: "Mark",
      personId: "person-1",
    };
    const view = render(
      <PersonFollowups
        {...props}
        active={[followup("active-1", "2026-07-01T00:00:00.000Z", "Due Jul 15")]}
        resolved={[followup("resolved-1", "2026-07-01T00:00:00.000Z", "Due Jul 15", "completed")]}
      />,
    );

    view.rerender(
      <PersonFollowups
        {...props}
        active={[followup("active-1", "2026-07-02T00:00:00.000Z", "Due today")]}
        resolved={[
          followup("resolved-1", "2026-07-02T00:00:00.000Z", "Was due Jul 15", "completed"),
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-active-1").textContent).toBe("Due today");
      expect(screen.getByTestId("resolved-resolved-1").textContent).toBe("Was due Jul 15");
    });
  });
});
