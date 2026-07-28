// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftView } from "@/lib/draft-view";
import type { GmailDraftView } from "@/lib/gmail-draft-view";
import { render, screen, userEvent } from "@/test/dom";

/**
 * The Gmail write gate in a real DOM (ADR-0083/0085/0088/0091). The sibling
 * `gmail-draft-panel.test.tsx` pins which state the panel *shows* for each Gmail
 * outcome; this file pins what actually happens when someone opens the panel and
 * presses submit — what reaches the server action, whether a create or an update
 * runs, and where the panel lands on a block, a failure, or a thrown call.
 */

const createGmailDraftAction = vi.fn();
const updateGmailDraftAction = vi.fn();
const retryGmailDraftAction = vi.fn();

vi.mock("@/app/actions/gmail-drafts", () => ({
  createGmailDraftAction: async (...args: unknown[]) => ({
    ok: true,
    view: await createGmailDraftAction(...args),
  }),
  updateGmailDraftAction: async (...args: unknown[]) => ({
    ok: true,
    view: await updateGmailDraftAction(...args),
  }),
  retryGmailDraftAction: async (...args: unknown[]) => ({
    ok: true,
    view: await retryGmailDraftAction(...args),
  }),
}));

import { GmailDraftPanel, type PersonEmailOption } from "./gmail-draft-panel";

const DRAFT: DraftView = {
  id: "11111111-1111-1111-1111-111111111111",
  personId: "p1",
  status: "approved",
  statusLabel: "Approved",
  channel: "email",
  purpose: "check_in",
  body: "Hey Casey, good to reconnect.",
  editable: true,
  grounding: [],
  createdAt: "2026-06-27T00:00:00.000Z",
  updatedAt: "2026-06-27T00:00:00.000Z",
};

const SAVED_EMAIL: PersonEmailOption = { id: "cm-1", value: "casey@example.com", isPrimary: true };
const WORK_EMAIL: PersonEmailOption = { id: "cm-2", value: "casey@work.example", isPrimary: false };

const succeeded: GmailDraftView = {
  actionId: "a1",
  status: "succeeded",
  kind: "create",
  gmailDraftId: "g1",
  subject: "Checking in, Casey",
  recipientEmail: SAVED_EMAIL.value,
  error: null,
};

const failed: GmailDraftView = {
  ...succeeded,
  status: "failed",
  gmailDraftId: null,
  error: "Gmail is unavailable.",
};

describe("GmailDraftPanel write gate", () => {
  /** Renders a connected panel for Casey and hands back the `onWrite` refresh spy. */
  function renderPanel(props: Partial<Parameters<typeof GmailDraftPanel>[0]> = {}) {
    const onWrite = vi.fn();
    render(
      <GmailDraftPanel
        connected
        draft={DRAFT}
        initialView={null}
        onWrite={onWrite}
        personEmails={[SAVED_EMAIL]}
        personName="Casey"
        {...props}
      />,
    );
    return onWrite;
  }

  /** Opens the collapsed panel, then submits whatever it was prefilled with. */
  async function openAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    const submit = () => screen.getByRole("button", { name: "Save to Gmail" });
    await user.click(submit());
    await user.click(submit());
  }

  beforeEach(() => {
    createGmailDraftAction.mockReset();
    updateGmailDraftAction.mockReset();
    retryGmailDraftAction.mockReset();
  });

  it("refuses to write until a recipient address is entered", async () => {
    const user = userEvent.setup();
    renderPanel({ personEmails: [] });

    await openAndSubmit(user);

    expect(screen.getByRole("alert").textContent).toBe("Add a recipient email address first.");
    expect(createGmailDraftAction).not.toHaveBeenCalled();
  });

  it("refuses to write an approved draft with an emptied subject", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Save to Gmail" }));
    await user.clear(screen.getByRole("textbox", { name: "Subject" }));
    await user.click(screen.getByRole("button", { name: "Save to Gmail" }));

    expect(screen.getByRole("alert").textContent).toBe("Add a subject first.");
    expect(createGmailDraftAction).not.toHaveBeenCalled();
  });

  it("writes the trimmed subject, chosen recipient, and edited body, then shows the Gmail state", async () => {
    const user = userEvent.setup();
    createGmailDraftAction.mockResolvedValue({ status: "succeeded", view: succeeded });
    const onWrite = renderPanel();

    await user.click(screen.getByRole("button", { name: "Save to Gmail" }));
    const subject = screen.getByRole("textbox", { name: "Subject" });
    await user.clear(subject);
    await user.type(subject, "  Checking in  ");
    await user.type(screen.getByRole("textbox", { name: "Message" }), " Talk soon.");
    await user.click(screen.getByRole("button", { name: "Save to Gmail" }));

    expect(createGmailDraftAction).toHaveBeenCalledWith({
      draftId: DRAFT.id,
      subject: "Checking in",
      recipient: {
        email: SAVED_EMAIL.value,
        source: "contact_method",
        contactMethodId: SAVED_EMAIL.id,
      },
      bodyEdit: `${DRAFT.body} Talk soon.`,
    });
    // Success collapses the form back to the last known external state (ADR-0089).
    expect(await screen.findByText(/Saved as a Gmail draft/)).toBeTruthy();
    expect(screen.getByText(SAVED_EMAIL.value)).toBeTruthy();
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("writes to whichever saved address the owner picks over the primary default", async () => {
    const user = userEvent.setup();
    createGmailDraftAction.mockResolvedValue({
      status: "succeeded",
      view: { ...succeeded, recipientEmail: WORK_EMAIL.value },
    });
    renderPanel({ personEmails: [SAVED_EMAIL, WORK_EMAIL] });

    await user.click(screen.getByRole("button", { name: "Save to Gmail" }));
    // The primary saved address is the prefilled default; picking another overrides it.
    const primary = screen.getByRole<HTMLInputElement>("radio", { name: /^casey@example\.com/ });
    expect(primary.checked).toBe(true);
    await user.click(screen.getByRole("radio", { name: WORK_EMAIL.value }));
    await user.click(screen.getByRole("button", { name: "Save to Gmail" }));

    expect(createGmailDraftAction).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: {
          email: WORK_EMAIL.value,
          source: "contact_method",
          contactMethodId: WORK_EMAIL.id,
        },
      }),
    );
    expect(await screen.findByText(WORK_EMAIL.value)).toBeTruthy();
  });

  it("sends to a one-off address without saving it to the profile (ADR-0085)", async () => {
    const user = userEvent.setup();
    createGmailDraftAction.mockResolvedValue({
      status: "succeeded",
      view: { ...succeeded, recipientEmail: WORK_EMAIL.value },
    });
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Save to Gmail" }));
    await user.click(screen.getByRole("radio", { name: "Another address" }));
    await user.type(
      screen.getByRole("textbox", { name: "Recipient email address" }),
      WORK_EMAIL.value,
    );
    expect(screen.getByText(/isn't saved to their profile/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save to Gmail" }));

    expect(createGmailDraftAction).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: { email: WORK_EMAIL.value, source: "manual_entry", contactMethodId: null },
      }),
    );
    expect(await screen.findByText(WORK_EMAIL.value)).toBeTruthy();
  });

  it("surfaces a blocked write's reason and leaves the panel open without refreshing", async () => {
    const user = userEvent.setup();
    createGmailDraftAction.mockResolvedValue({
      status: "blocked",
      reason: "Reconnect Gmail to save this draft.",
    });
    const onWrite = renderPanel();

    await openAndSubmit(user);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Reconnect Gmail to save this draft.",
    );
    expect(screen.getByRole("button", { name: "Save to Gmail" })).toBeTruthy();
    // Nothing was written, so the surface has no new counts to pick up.
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("keeps the composed draft in front of the owner when the write fails", async () => {
    const user = userEvent.setup();
    createGmailDraftAction.mockResolvedValue({ status: "failed", view: failed });
    const onWrite = renderPanel();

    await openAndSubmit(user);

    expect((await screen.findByRole("alert")).textContent).toBe("Gmail is unavailable.");
    expect(screen.getByRole("button", { name: "Save to Gmail" })).toBeTruthy();
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("tells the owner to try again when the write throws", async () => {
    const user = userEvent.setup();
    createGmailDraftAction.mockRejectedValue(new Error("network"));
    const onWrite = renderPanel();

    await openAndSubmit(user);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't save this draft to Gmail. Try again.",
    );
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("names the update operation when a failed update carries no provider error", async () => {
    const user = userEvent.setup();
    updateGmailDraftAction.mockResolvedValue({
      status: "failed",
      view: { ...failed, kind: "update", error: null },
    });
    renderPanel({ initialView: succeeded });

    await user.click(screen.getByRole("button", { name: "Update in Gmail" }));
    await user.click(screen.getByRole("button", { name: "Update Gmail draft" }));

    // Without a provider message the fallback has to describe the operation that
    // actually ran, rather than telling the owner a create failed.
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't update the Gmail draft.");
  });

  it("abandons the write and drops the error when the owner cancels", async () => {
    const user = userEvent.setup();
    renderPanel({ personEmails: [] });

    await openAndSubmit(user);
    expect(screen.getByRole("alert")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Subject" })).toBeNull();

    // Reopening starts clean rather than resurfacing the abandoned attempt's error.
    await user.click(screen.getByRole("button", { name: "Save to Gmail" }));
    expect(screen.getByRole("textbox", { name: "Subject" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(createGmailDraftAction).not.toHaveBeenCalled();
  });

  it("routes an explicit update of a linked Gmail draft to the update action (ADR-0088)", async () => {
    const user = userEvent.setup();
    updateGmailDraftAction.mockResolvedValue({
      status: "succeeded",
      view: { ...succeeded, kind: "update", subject: "Checking in again, Casey" },
    });
    renderPanel({ initialView: succeeded });

    await user.click(screen.getByRole("button", { name: "Update in Gmail" }));
    const subject = screen.getByRole<HTMLInputElement>("textbox", { name: "Subject" });
    expect(subject.value).toBe(succeeded.subject);
    await user.clear(subject);
    await user.type(subject, "Checking in again, Casey");
    await user.click(screen.getByRole("button", { name: "Update Gmail draft" }));

    expect(updateGmailDraftAction).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: DRAFT.id, subject: "Checking in again, Casey" }),
    );
    // An update never forks a second Gmail draft off the same Tendnote draft.
    expect(createGmailDraftAction).not.toHaveBeenCalled();
    expect(await screen.findByText(/Saved as a Gmail draft/)).toBeTruthy();
  });

  it("retries a failed write only when the owner asks for it (ADR-0091)", async () => {
    const user = userEvent.setup();
    retryGmailDraftAction.mockResolvedValue({ status: "succeeded", view: succeeded });
    const onWrite = renderPanel({ initialView: failed });

    // Tendnote never retries in the background — the failure waits behind a button.
    expect(retryGmailDraftAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(retryGmailDraftAction).toHaveBeenCalledWith({
      draftId: DRAFT.id,
      actionId: succeeded.actionId,
    });
    expect(await screen.findByText(/Saved as a Gmail draft/)).toBeTruthy();
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("leaves the failure retryable when the retry itself throws", async () => {
    const user = userEvent.setup();
    retryGmailDraftAction.mockRejectedValue(new Error("network"));
    const onWrite = renderPanel({ initialView: failed });

    await user.click(screen.getByRole("button", { name: "Retry" }));

    // The button comes back out of its busy state, so the owner can try again.
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("save this draft to Gmail.");
    expect(onWrite).not.toHaveBeenCalled();
  });
});
