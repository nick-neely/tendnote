// @vitest-environment jsdom
import type { ContextFactView } from "@tendnote/domain/context-facts";
import type {
  HouseholdContextActorIdentity,
  HouseholdContextReconciliation,
} from "@tendnote/domain/household-context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// The surface imports its server actions as defaults; every test injects its
// own, so the real (server-only) module must never be pulled in.
vi.mock("@/app/actions/household-context", () => ({
  createHouseholdContextFactAction: vi.fn(),
  updateHouseholdContextFactAction: vi.fn(),
  archiveHouseholdContextFactAction: vi.fn(),
  restoreHouseholdContextFactAction: vi.fn(),
}));

// The category and sensitivity fields are Radix `Select`s, which reach for pointer
// capture, element sizing, and scroll positioning that jsdom does not implement.
HTMLElement.prototype.scrollIntoView ??= vi.fn();
HTMLElement.prototype.hasPointerCapture ??= vi.fn();
HTMLElement.prototype.releasePointerCapture ??= vi.fn();
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import {
  HouseholdContextSurface,
  type UpdateHouseholdContextAction,
} from "./household-context-surface";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const TWO_HOURS_AGO = new Date(NOW.getTime() - 7_200_000);
const AN_HOUR_AGO = new Date(NOW.getTime() - 3_600_000);
const HOUSEHOLD_ID = "household-1";
const ANA = "user-ana";
const BEN = "user-ben";

const IDENTITIES: HouseholdContextActorIdentity[] = [
  { userId: ANA, name: "Ana", isActiveMember: true },
  { userId: BEN, name: "Ben", isActiveMember: true },
  { userId: "user-sam", name: "Sam", isActiveMember: false },
];

function fact(overrides: Partial<ContextFactView> = {}): ContextFactView {
  const at = overrides.updatedAt ?? TWO_HOURS_AGO;
  return {
    id: "fact-1",
    subject: { kind: "household", householdId: HOUSEHOLD_ID },
    category: "location",
    content: "We're in the Lents neighbourhood.",
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "account", origin: "direct" },
    reviewedAt: at,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    trust: "untrusted_data",
    authority: "none",
    visibility: "household",
    actorAttribution: { creatorUserId: BEN, lastActorUserId: BEN },
    ...overrides,
  };
}

/** Drives a `Select`: open the trigger, then pick the item by its visible label. */
async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  option: string,
) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

function renderSurface(props: Partial<Parameters<typeof HouseholdContextSurface>[0]> = {}) {
  return render(
    <HouseholdContextSurface
      identities={IDENTITIES}
      initialFacts={[fact()]}
      renderedAt={NOW}
      viewerUserId={ANA}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("household context management", () => {
  it("states the shared audience before anything else on the page", () => {
    renderSurface();
    expect(screen.getByText("Shared with everyone here")).toBeTruthy();
  });

  it("credits the author while a fact is untouched", () => {
    renderSurface();
    expect(screen.getByText("Added by Ben · 2 hours ago")).toBeTruthy();
  });

  it("credits whoever corrected it once someone has", () => {
    renderSurface({
      initialFacts: [
        fact({
          createdAt: new Date(NOW.getTime() - 86_400_000),
          updatedAt: TWO_HOURS_AGO,
          actorAttribution: { creatorUserId: ANA, lastActorUserId: BEN },
        }),
      ],
    });
    expect(screen.getByText("Updated by Ben · 2 hours ago")).toBeTruthy();
  });

  it("keeps a departed member's name on what they wrote", () => {
    renderSurface({
      initialFacts: [
        fact({ actorAttribution: { creatorUserId: "user-sam", lastActorUserId: "user-sam" } }),
      ],
    });
    expect(screen.getByText(/Sam · former member/)).toBeTruthy();
  });

  it("offers no way for one member to delete a household fact outright", () => {
    renderSurface();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.getByText(/No one person can delete a household fact outright/)).toBeTruthy();
  });

  it("invites one useful fact when there is nothing here, without asking for a set", () => {
    renderSurface({ initialFacts: [] });
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    // No completion state, no progress, no count of what is missing.
    expect(screen.queryByText(/complete/i)).toBeNull();
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
  });

  /**
   * A likely duplicate or contradiction focuses the fact the household already
   * has, rather than letting a second current answer to the same question exist.
   */
  it("sends a duplicate to the fact that is already here", async () => {
    const user = userEvent.setup();
    const createAction = vi.fn().mockResolvedValue({
      ok: false,
      error: "Someone here has already written this down.",
      focusContextFactId: "fact-1",
    });
    renderSurface({ createAction });

    await user.click(screen.getByRole("button", { name: "Add a fact" }));
    await user.type(
      screen.getByRole("textbox", { name: "Fact" }),
      "We're in the Lents neighbourhood.",
    );
    await user.click(screen.getByRole("button", { name: "Save fact" }));

    const openExisting = await screen.findByRole("button", {
      name: /Open the fact that’s already here/,
    });
    await user.click(openExisting);

    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-household-context-edit")).toBe("fact-1");
    });
  });

  it("carries the version the reader saw on every write", async () => {
    const user = userEvent.setup();
    const updateAction = vi.fn().mockResolvedValue({
      ok: true,
      view: { outcome: "saved", decision: "updated", fact: fact({ content: "We moved." }) },
    });
    const existing = fact();
    renderSurface({ initialFacts: [existing], updateAction });

    await user.click(screen.getByRole("button", { name: /Edit the Location fact/ }));
    const textarea = screen.getByRole("textbox", { name: "Fact" });
    await user.clear(textarea);
    await user.type(textarea, "We moved.");
    await user.click(screen.getByRole("button", { name: "Save correction" }));

    await waitFor(() => expect(updateAction).toHaveBeenCalled());
    expect(updateAction.mock.calls[0]?.[0]).toMatchObject({
      contextFactId: existing.id,
      expectedUpdatedAt: existing.updatedAt.toISOString(),
      content: "We moved.",
    });
  });
});

describe("household context audience disclosure", () => {
  it("holds the save until a sensitive fact's whole-household reach is acknowledged", async () => {
    const user = userEvent.setup();
    const createAction = vi.fn();
    renderSurface({ createAction, initialFacts: [] });

    await user.click(screen.getByRole("button", { name: "Add a fact" }));
    await user.type(screen.getByRole("textbox", { name: "Fact" }), "One of us works nights.");
    expect(screen.getByRole("button", { name: "Save fact" }).hasAttribute("disabled")).toBe(false);

    await chooseOption(user, "Sensitivity", "Sensitive");

    expect(screen.getByText(/Everyone in the household will be able to read this/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save fact" }).hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Save fact" }).hasAttribute("disabled")).toBe(false);
    expect(createAction).not.toHaveBeenCalled();
  });

  it("asks again when the sensitivity is escalated a second time", async () => {
    const user = userEvent.setup();
    renderSurface({ initialFacts: [] });

    await user.click(screen.getByRole("button", { name: "Add a fact" }));
    await user.type(screen.getByRole("textbox", { name: "Fact" }), "One of us works nights.");
    await chooseOption(user, "Sensitivity", "Sensitive");
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Save fact" }).hasAttribute("disabled")).toBe(false);

    await chooseOption(user, "Sensitivity", "Restricted");
    expect(screen.getByRole("button", { name: "Save fact" }).hasAttribute("disabled")).toBe(true);
  });

  it("says nothing extra for a normal fact, so the warning keeps its weight", async () => {
    const user = userEvent.setup();
    renderSurface({ initialFacts: [] });
    await user.click(screen.getByRole("button", { name: "Add a fact" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("household context reconciliation", () => {
  const CURRENT: HouseholdContextReconciliation["current"] = {
    contextFactId: "fact-1",
    category: "location",
    content: "We moved over to Sellwood.",
    sensitivity: "normal",
    lifecycle: "active",
    updatedAt: AN_HOUR_AGO,
    lastActorUserId: BEN,
  };

  function staleResult(overrides: Partial<typeof CURRENT> = {}) {
    const current = { ...CURRENT, ...overrides };
    return {
      ok: true as const,
      view: {
        outcome: "stale" as const,
        reconciliation: {
          draft: {
            category: "location" as const,
            content: "We're moving to Sellwood in the spring.",
            sensitivity: "normal" as const,
          },
          current,
          choices:
            current.lifecycle === "archived"
              ? (["keep_current", "revise"] as const)
              : (["keep_current", "revise", "replace"] as const),
          draftDiffers: true,
        },
      },
    };
  }

  async function openStaleEdit(
    user: ReturnType<typeof userEvent.setup>,
    updateAction: UpdateHouseholdContextAction,
  ) {
    renderSurface({ initialFacts: [fact()], updateAction });
    await user.click(screen.getByRole("button", { name: /Edit the Location fact/ }));
    const textarea = screen.getByRole("textbox", { name: "Fact" });
    await user.clear(textarea);
    await user.type(textarea, "We're moving to Sellwood in the spring.");
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    return textarea as HTMLTextAreaElement;
  }

  it("keeps the draft on screen and shows the current statement with its actor", async () => {
    const user = userEvent.setup();
    const updateAction = vi.fn().mockResolvedValue(staleResult());
    const textarea = await openStaleEdit(
      user,
      updateAction as unknown as UpdateHouseholdContextAction,
    );

    const panel = await screen.findByRole("region", {
      name: "Ben changed this while you were writing",
    });
    // Nothing was lost: the member's wording is still in the form.
    expect(textarea.value).toBe("We're moving to Sellwood in the spring.");
    expect(within(panel).getByText("We moved over to Sellwood.")).toBeTruthy();
    expect(within(panel).getByText(/Ben · an hour ago/)).toBeTruthy();
    expect(within(panel).getByText("What you wrote")).toBeTruthy();
  });

  it("offers all three ways on, and makes none of them the recommended one", async () => {
    const user = userEvent.setup();
    const updateAction = vi.fn().mockResolvedValue(staleResult());
    await openStaleEdit(user, updateAction as unknown as UpdateHouseholdContextAction);

    const panel = await screen.findByRole("region", {
      name: "Ben changed this while you were writing",
    });
    for (const label of ["Keep theirs", "Revise mine", "Replace with mine"]) {
      const button = within(panel).getByRole("button", { name: label });
      // Every choice is an outline; the form's Save keeps the only primary.
      expect(button.getAttribute("data-variant")).toBe("outline");
    }
  });

  it("moves focus to the panel, because the press that opened it changed nothing", async () => {
    const user = userEvent.setup();
    const updateAction = vi.fn().mockResolvedValue(staleResult());
    await openStaleEdit(user, updateAction as unknown as UpdateHouseholdContextAction);

    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Ben changed this while you were writing");
    });
  });

  it("replaces by resubmitting against the version it just showed, never by forcing", async () => {
    const user = userEvent.setup();
    const updateAction = vi
      .fn()
      .mockResolvedValueOnce(staleResult())
      .mockResolvedValueOnce({
        ok: true,
        view: {
          outcome: "saved",
          decision: "updated",
          fact: fact({ content: "We're moving to Sellwood in the spring." }),
        },
      });
    await openStaleEdit(user, updateAction as unknown as UpdateHouseholdContextAction);

    const panel = await screen.findByRole("region", {
      name: "Ben changed this while you were writing",
    });
    await user.click(within(panel).getByRole("button", { name: "Replace with mine" }));

    await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(2));
    expect(updateAction.mock.calls[1]?.[0]).toMatchObject({
      expectedUpdatedAt: CURRENT.updatedAt.toISOString(),
      content: "We're moving to Sellwood in the spring.",
    });
  });

  it("returns a reviser to their own draft, fenced against what they just read", async () => {
    const user = userEvent.setup();
    const updateAction = vi
      .fn()
      .mockResolvedValueOnce(staleResult())
      .mockResolvedValueOnce({
        ok: true,
        view: {
          outcome: "saved",
          decision: "updated",
          fact: fact({ content: "Sellwood, spring." }),
        },
      });
    const textarea = await openStaleEdit(
      user,
      updateAction as unknown as UpdateHouseholdContextAction,
    );

    const panel = await screen.findByRole("region", {
      name: "Ben changed this while you were writing",
    });
    await user.click(within(panel).getByRole("button", { name: "Revise mine" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Ben changed this while you were writing" }),
      ).toBeNull();
    });
    expect(textarea.value).toBe("We're moving to Sellwood in the spring.");

    await user.clear(textarea);
    await user.type(textarea, "Sellwood, spring.");
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(2));
    expect(updateAction.mock.calls[1]?.[0]).toMatchObject({
      expectedUpdatedAt: CURRENT.updatedAt.toISOString(),
    });
  });

  it("closes the editor and says so when the reader keeps the current wording", async () => {
    const user = userEvent.setup();
    const updateAction = vi.fn().mockResolvedValue(staleResult());
    await openStaleEdit(user, updateAction as unknown as UpdateHouseholdContextAction);

    const panel = await screen.findByRole("region", {
      name: "Ben changed this while you were writing",
    });
    await user.click(within(panel).getByRole("button", { name: "Keep theirs" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Kept the current wording.");
    });
    expect(screen.queryByRole("textbox", { name: "Fact" })).toBeNull();
    expect(updateAction).toHaveBeenCalledTimes(1);
  });

  it("withholds replace when the current statement was archived instead of changed", async () => {
    const user = userEvent.setup();
    const updateAction = vi.fn().mockResolvedValue(staleResult({ lifecycle: "archived" }));
    await openStaleEdit(user, updateAction as unknown as UpdateHouseholdContextAction);

    const panel = await screen.findByRole("region", {
      name: "Ben archived this while you were writing",
    });
    expect(within(panel).queryByRole("button", { name: "Replace with mine" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Keep theirs" })).toBeTruthy();
  });
});

describe("household context lifecycle", () => {
  it("pauses before taking a current fact out of what everyone sees", async () => {
    const user = userEvent.setup();
    const archiveAction = vi.fn().mockResolvedValue({
      ok: true,
      view: {
        outcome: "saved",
        decision: "archived",
        fact: fact({ lifecycle: "archived", archivedAt: NOW, updatedAt: NOW }),
      },
    });
    renderSurface({ archiveAction });

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByText(/Archiving takes this out of what everyone sees/)).toBeTruthy();
    expect(archiveAction).not.toHaveBeenCalled();

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }),
    );
    await waitFor(() => expect(archiveAction).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Archived. Anyone here can restore it.");
    });
  });

  it("keeps archived facts behind disclosure and lets anyone here restore one", async () => {
    const user = userEvent.setup();
    const restoreAction = vi.fn().mockResolvedValue({
      ok: true,
      view: { outcome: "saved", decision: "restored", fact: fact({ updatedAt: NOW }) },
    });
    renderSurface({
      initialFacts: [fact({ lifecycle: "archived", archivedAt: NOW })],
      restoreAction,
    });

    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Show archived facts \(1\)/ }));
    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(restoreAction).toHaveBeenCalled());
    expect(restoreAction.mock.calls[0]?.[0]).toMatchObject({ contextFactId: "fact-1" });
  });

  it("explains a stale archive without inventing the state it just failed to read", async () => {
    const user = userEvent.setup();
    const archiveAction = vi.fn().mockResolvedValue({
      ok: true,
      view: {
        outcome: "stale",
        reconciliation: {
          draft: { category: "location", content: "x", sensitivity: "normal" },
          current: {
            contextFactId: "fact-1",
            category: "location",
            content: "We moved over to Sellwood.",
            sensitivity: "normal",
            lifecycle: "active",
            updatedAt: NOW,
            lastActorUserId: BEN,
          },
          choices: ["keep_current", "revise", "replace"],
          draftDiffers: true,
        },
      },
    });
    renderSurface({ archiveAction });

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "Someone here changed this while the page was open",
      );
    });
    expect(refresh).toHaveBeenCalled();
  });
});
