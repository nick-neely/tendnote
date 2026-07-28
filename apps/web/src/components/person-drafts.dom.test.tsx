// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftView } from "@/lib/draft-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";
import type { GmailDraftContext } from "./person-drafts";

/**
 * Behaviour of a draft review card's actions, in a real DOM. The sibling
 * `person-drafts.test.tsx` pins which affordances a draft *shows* for each status;
 * this file pins what pressing them *does* — the server action each one runs, where
 * the card lands afterwards, and what it says when an action returns nothing or fails.
 */

const actions = vi.hoisted(() => ({
  approveDraftAction: vi.fn(),
  dismissDraftAction: vi.fn(),
  editDraftBodyAction: vi.fn(),
  markDraftSentManuallyAction: vi.fn(),
  regenerateDraftAction: vi.fn(),
}));

vi.mock("@/app/actions/drafts", () => actions);

// The Gmail panel imports server actions that reach `server-only`; stub them so the
// approved-draft card mounts client-side.
vi.mock("@/app/actions/gmail-drafts", () => ({
  createGmailDraftAction: vi.fn(),
  retryGmailDraftAction: vi.fn(),
  updateGmailDraftAction: vi.fn(),
}));

// The entry-point button uses a router-backed hook of its own.
vi.mock("@/components/use-create-draft", () => ({
  useCreateDraft: () => ({ create: vi.fn(), pending: false, error: null }),
}));

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh, push: vi.fn() }),
}));

// The approved card links out to account settings through `next/link`, which reaches
// for an app-router context a bare client tree does not provide.
vi.mock("next/link", () => import("@/test/next-link-mock"));

import { PersonDrafts } from "./person-drafts";

const PERSON_ID = "person-1";
const DRAFT_ID = "33333333-3333-3333-3333-333333333333";
const REGENERATED_ID = "44444444-4444-4444-4444-444444444444";

function view(overrides: Partial<DraftView> = {}): DraftView {
  return {
    id: DRAFT_ID,
    personId: "person-1",
    status: "draft",
    statusLabel: "Draft",
    channel: "text",
    purpose: "check_in",
    body: "Hey Mark — heard you moved to Denver, how's the new place?",
    editable: true,
    grounding: [
      {
        kind: "approved_memory",
        trust: "confirmed_fact",
        trustLabel: "Confirmed",
        label: "Moved to Denver",
      },
    ],
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    ...overrides,
  };
}

function gmailContext(overrides: Partial<GmailDraftContext> = {}): GmailDraftContext {
  return { connected: false, personName: "Mark", personEmails: [], byDraftId: {}, ...overrides };
}

/**
 * The inline draft editor is Tiptap/ProseMirror, which measures the caret to scroll it
 * into view after every transaction. jsdom has no layout engine and implements no
 * `Range` measurement at all, so that probe throws asynchronously — the editor still
 * behaves correctly, but the unhandled error fails the run. Answering with empty
 * rectangles is the honest jsdom answer: there is no geometry to report.
 */
function stubRangeMeasurement(): void {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

describe("DraftReviewCard", () => {
  beforeAll(stubRangeMeasurement);

  beforeEach(() => {
    routerRefresh.mockReset();
    for (const action of Object.values(actions)) {
      action.mockReset();
    }
  });

  function renderCard(draft: DraftView = view(), gmail = gmailContext()) {
    return render(<PersonDrafts gmail={gmail} initialDrafts={[draft]} personId={PERSON_ID} />);
  }

  it("approves a draft and moves the card into its approved state", async () => {
    const user = userEvent.setup();
    actions.approveDraftAction.mockResolvedValue({
      ok: true,
      view: view({ status: "approved", statusLabel: "Approved" }),
    });
    renderCard();

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(actions.approveDraftAction).toHaveBeenCalledWith({ draftId: DRAFT_ID });
    expect(await screen.findByText("Approved")).toBeTruthy();
    // Approving is a one-way step, and it is what unlocks the Gmail handoff.
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark sent" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect Gmail" })).toBeTruthy();
    // The page re-reads the server so the Drafts tab count stays honest.
    expect(routerRefresh).toHaveBeenCalled();
  });

  it("dismisses a draft and retires its review actions", async () => {
    const user = userEvent.setup();
    actions.dismissDraftAction.mockResolvedValue({
      ok: true,
      view: view({ status: "dismissed", statusLabel: "Dismissed", editable: false }),
    });
    renderCard();

    await user.click(screen.getByRole("button", { name: "Dismiss draft" }));

    expect(actions.dismissDraftAction).toHaveBeenCalledWith({ draftId: DRAFT_ID });
    expect(await screen.findByText("Dismissed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark sent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();
  });

  it("keeps a regenerated draft beside the one it was written from", async () => {
    const user = userEvent.setup();
    actions.regenerateDraftAction.mockResolvedValue({
      ok: true,
      view: {
        draft: view({
          id: REGENERATED_ID,
          body: "Hey Mark, how is Denver treating you?",
          createdAt: "2026-06-28T00:00:00.000Z",
        }),
      },
    });
    renderCard();

    await user.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(actions.regenerateDraftAction).toHaveBeenCalledWith({ draftId: DRAFT_ID });
    expect(await screen.findByText(/how is Denver treating you/)).toBeTruthy();
    // Regenerating never overwrites what the user already had a chance to read.
    expect(screen.getByText(/heard you moved to Denver/)).toBeTruthy();
  });

  it("says why a regenerate produced nothing rather than failing silently", async () => {
    const user = userEvent.setup();
    actions.regenerateDraftAction.mockResolvedValue({ ok: true, view: { draft: null } });
    renderCard();

    await user.click(screen.getByRole("button", { name: "Regenerate" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Not enough saved context about this person to regenerate.",
    );
    expect(screen.getByText(/heard you moved to Denver/)).toBeTruthy();
  });

  it("reports a regenerate that failed outright", async () => {
    const user = userEvent.setup();
    actions.regenerateDraftAction.mockRejectedValue(new Error("offline"));
    renderCard();

    await user.click(screen.getByRole("button", { name: "Regenerate" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't regenerate this draft.");
  });

  it("copies the draft body and confirms it on the button", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(await window.navigator.clipboard.readText()).toContain("heard you moved to Denver");
  });

  it("saves an edited body and returns to the read view", async () => {
    const user = userEvent.setup();
    const edited = `${view().body} Congrats!`;
    actions.editDraftBodyAction.mockResolvedValue({ ok: true, view: view({ body: edited }) });
    renderCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    // Focused directly rather than clicked: ProseMirror maps a click through
    // `document.elementFromPoint`, which jsdom does not implement. The editor opens
    // with the caret at the end of the draft, so typing continues the message.
    (await screen.findByLabelText("Edit draft")).focus();
    await user.keyboard(" Congrats!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(actions.editDraftBodyAction).toHaveBeenCalledWith({
        draftId: DRAFT_ID,
        body: edited,
      }),
    );
    expect(await screen.findByText(edited)).toBeTruthy();
    expect(screen.queryByLabelText("Edit draft")).toBeNull();
  });

  it("leaves the draft alone when an edit is closed without a change", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(actions.editDraftBodyAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByText(/heard you moved to Denver/)).toBeTruthy();
  });
});
