// @vitest-environment jsdom
import type { Sensitivity } from "@tendnote/domain";
import type { PrivacyScope } from "@tendnote/domain/privacy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

// jsdom has no ResizeObserver, which the radix Checkbox measures its bubble
// input with.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock("@/app/actions/relationship-shares", () => ({
  setRelationshipShareAudienceAction: vi.fn(),
}));

import {
  RelationshipShareControl,
  type SetRelationshipShareAudience,
} from "./relationship-share-control";

const RECORD_ID = "11111111-1111-4111-8111-111111111111";

const MEMBERS = [
  { userId: "member-2", name: "Jon", email: "jon@example.com" },
  { userId: "member-3", name: "Sam", email: "sam@example.com" },
];

function shareResult(overrides: { scope?: PrivacyScope; selectedUserIds?: string[] } = {}) {
  return {
    ok: true as const,
    view: {
      recordKind: "memory" as const,
      recordId: RECORD_ID,
      scope: overrides.scope ?? ("shared" as PrivacyScope),
      visibilityChoice: "selected_members" as const,
      selectedUserIds: overrides.selectedUserIds ?? ["member-2"],
      sensitivity: "normal" as const,
      householdName: "Rivera House",
    },
  };
}

function renderControl(
  props: Partial<{
    scope: PrivacyScope;
    sensitivity: Sensitivity;
    selectedUserIds: string[];
    shareableMembers: typeof MEMBERS;
    setAudienceAction: SetRelationshipShareAudience;
  }> = {},
) {
  const setAudienceAction = props.setAudienceAction ?? vi.fn().mockResolvedValue(shareResult());
  render(
    <RelationshipShareControl
      householdName="Rivera House"
      recordId={RECORD_ID}
      recordKind="memory"
      scope={props.scope ?? "private"}
      selectedUserIds={props.selectedUserIds ?? []}
      sensitivity={props.sensitivity ?? "normal"}
      setAudienceAction={setAudienceAction}
      shareableMembers={props.shareableMembers ?? MEMBERS}
    >
      <span>context · high confidence</span>
    </RelationshipShareControl>,
  );
  return { setAudienceAction };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("at rest", () => {
  it("shows the row's own metadata and no audience badge when private", () => {
    renderControl();

    expect(screen.getByText("context · high confidence")).toBeTruthy();
    expect(screen.queryByText(/Shared with/)).toBeNull();
    expect(screen.queryByText("Whole household")).toBeNull();
  });

  it("states the audience quietly once a record is shared", () => {
    renderControl({ scope: "shared", selectedUserIds: ["member-2"] });
    expect(screen.getByText("Shared with 1 person")).toBeTruthy();
  });

  it("offers no control at all to someone with no household", () => {
    renderControl({ shareableMembers: [] });
    expect(screen.queryByRole("button", { name: "Visibility" })).toBeNull();
  });

  it("keeps the editor closed until it is asked for", () => {
    renderControl();
    expect(screen.queryByRole("button", { name: /Save visibility/ })).toBeNull();
  });
});

describe("choosing an audience", () => {
  it("shares with the whole household", async () => {
    const user = userEvent.setup();
    const setAudienceAction = vi
      .fn()
      .mockResolvedValue(shareResult({ scope: "household", selectedUserIds: [] }));
    renderControl({ setAudienceAction });

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Whole household/ }));
    await user.click(screen.getByRole("button", { name: /Save visibility/ }));

    await waitFor(() => {
      expect(setAudienceAction).toHaveBeenCalledWith({
        recordKind: "memory",
        recordId: RECORD_ID,
        visibilityChoice: "whole_household",
      });
    });
    // The row reports the answer it got back, then closes.
    expect(await screen.findByText("Whole household")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Save visibility/ })).toBeNull();
  });

  it("will not commit specific people with nobody chosen", async () => {
    const user = userEvent.setup();
    const { setAudienceAction } = renderControl();

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Specific people/ }));

    const save = screen.getByRole("button", { name: /Save visibility/ });
    expect(save.hasAttribute("disabled")).toBe(true);
    await user.click(save);
    expect(setAudienceAction).not.toHaveBeenCalled();
  });

  it("sends the chosen members once one is picked", async () => {
    const user = userEvent.setup();
    const { setAudienceAction } = renderControl();

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Specific people/ }));
    await user.click(screen.getByRole("checkbox", { name: /Jon/ }));
    await user.click(screen.getByRole("button", { name: /Save visibility/ }));

    await waitFor(() => {
      expect(setAudienceAction).toHaveBeenCalledWith({
        recordKind: "memory",
        recordId: RECORD_ID,
        visibilityChoice: "selected_members",
        selectedUserIds: ["member-2"],
      });
    });
  });

  it("says who will be able to see it before the commit", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Whole household/ }));

    expect(screen.getByText("Visible to all 3 household members.")).toBeTruthy();
  });

  it("takes a shared record back to private", async () => {
    const user = userEvent.setup();
    const setAudienceAction = vi
      .fn()
      .mockResolvedValue(shareResult({ scope: "private", selectedUserIds: [] }));
    renderControl({ scope: "shared", selectedUserIds: ["member-2"], setAudienceAction });

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Only me/ }));
    await user.click(screen.getByRole("button", { name: /Save visibility/ }));

    await waitFor(() => {
      expect(setAudienceAction).toHaveBeenCalledWith({
        recordKind: "memory",
        recordId: RECORD_ID,
        visibilityChoice: "only_me",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText(/Shared with/)).toBeNull();
    });
  });
});

describe("restricted content", () => {
  it("holds the commit until the owner confirms the named audience", async () => {
    const user = userEvent.setup();
    const { setAudienceAction } = renderControl({ sensitivity: "restricted" });

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Whole household/ }));

    expect(
      screen.getByText(
        "Every active member of Rivera House will be able to read this restricted memory, including anyone who joins later.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save visibility/ }).hasAttribute("disabled")).toBe(
      true,
    );

    await user.click(screen.getByRole("checkbox", { name: /Every active member/ }));
    await user.click(screen.getByRole("button", { name: /Save visibility/ }));

    await waitFor(() => {
      expect(setAudienceAction).toHaveBeenCalledWith(
        expect.objectContaining({ confirmedRestricted: true }),
      );
    });
  });

  it("names each selected member in the confirmation", async () => {
    const user = userEvent.setup();
    renderControl({ sensitivity: "restricted" });

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Specific people/ }));
    await user.click(screen.getByRole("checkbox", { name: /Jon/ }));
    await user.click(screen.getByRole("checkbox", { name: /Sam/ }));

    expect(
      screen.getByText("Jon and Sam will each be able to read this restricted memory."),
    ).toBeTruthy();
  });

  /**
   * A confirmation is about one audience. Widening after confirming must not
   * carry the old yes forward.
   */
  it("retracts the confirmation when the audience changes underneath it", async () => {
    const user = userEvent.setup();
    renderControl({ sensitivity: "restricted" });

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Specific people/ }));
    await user.click(screen.getByRole("checkbox", { name: /Jon/ }));
    await user.click(screen.getByRole("checkbox", { name: /will be able to read/ }));
    expect(screen.getByRole("button", { name: /Save visibility/ }).hasAttribute("disabled")).toBe(
      false,
    );

    await user.click(screen.getByRole("radio", { name: /Whole household/ }));
    expect(screen.getByRole("button", { name: /Save visibility/ }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("needs no confirmation to take restricted content back", async () => {
    const user = userEvent.setup();
    const setAudienceAction = vi
      .fn()
      .mockResolvedValue(shareResult({ scope: "private", selectedUserIds: [] }));
    renderControl({ scope: "household", sensitivity: "restricted", setAudienceAction });

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Only me/ }));

    expect(screen.queryByText(/will be able to read/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Save visibility/ }));
    await waitFor(() => {
      expect(setAudienceAction).toHaveBeenCalledWith(
        expect.objectContaining({ visibilityChoice: "only_me" }),
      );
    });
  });
});

describe("keyboard and assistive tech", () => {
  /**
   * Closing the form destroys the control that had focus. Without a deliberate
   * restore, focus lands on the body — and on a ledger of twenty memories that
   * means tabbing from the top again to reach the twenty-first control.
   */
  it("returns focus to the trigger after a save", async () => {
    const user = userEvent.setup();
    renderControl();

    const trigger = screen.getByRole("button", { name: "Visibility" });
    await user.click(trigger);
    await user.click(screen.getByRole("radio", { name: /Whole household/ }));
    await user.click(screen.getByRole("button", { name: /Save visibility/ }));

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("returns focus to the trigger after a cancel", async () => {
    const user = userEvent.setup();
    renderControl();

    const trigger = screen.getByRole("button", { name: "Visibility" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(trigger);
  });

  it("announces the audience the record actually ended up with", async () => {
    const user = userEvent.setup();
    const setAudienceAction = vi
      .fn()
      .mockResolvedValue(shareResult({ scope: "household", selectedUserIds: [] }));
    renderControl({ setAudienceAction });

    // The region is mounted before the press, not created by it: a live region
    // inserted alongside its own text is unreliably announced.
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Whole household/ }));
    await user.click(screen.getByRole("button", { name: /Save visibility/ }));

    await waitFor(() => {
      expect(region.textContent).toBe("Visibility saved. Whole household.");
    });
  });

  /**
   * Going private removes the row's chip, so the announcement is the only signal
   * a screen-reader user gets that the record came back — the change most worth
   * confirming.
   */
  it("announces a record coming back to private, which shows no chip", async () => {
    const user = userEvent.setup();
    const setAudienceAction = vi
      .fn()
      .mockResolvedValue(shareResult({ scope: "private", selectedUserIds: [] }));
    renderControl({ scope: "shared", selectedUserIds: ["member-2"], setAudienceAction });

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Only me/ }));
    await user.click(screen.getByRole("button", { name: /Save visibility/ }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Visibility saved. Only you can see this.",
      );
    });
  });
});

describe("the replacement warning", () => {
  it("stays away from a record that has no audience to replace", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Specific people/ }));

    expect(screen.queryByText(/replace who this is shared with/)).toBeNull();
  });

  it("warns in future tense on a record that already has one", async () => {
    const user = userEvent.setup();
    renderControl({ scope: "shared", selectedUserIds: ["member-2"] });

    await user.click(screen.getByRole("button", { name: "Visibility" }));

    expect(screen.getByText("Saving will replace who this is shared with.")).toBeTruthy();
    // Nothing here may read as something that already happened to the owner.
    expect(screen.queryByText(/is cleared/)).toBeNull();
  });
});

describe("when it does not go through", () => {
  it("renders the refusal and leaves the row's stated audience alone", async () => {
    const user = userEvent.setup();
    const setAudienceAction = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "That's no longer available." });
    renderControl({ scope: "shared", selectedUserIds: ["member-2"], setAudienceAction });

    await user.click(screen.getByRole("button", { name: "Visibility" }));
    await user.click(screen.getByRole("radio", { name: /Whole household/ }));
    await user.click(screen.getByRole("button", { name: /Save visibility/ }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That's no longer available.",
    );
    expect(screen.getByText("Shared with 1 person")).toBeTruthy();
  });
});
