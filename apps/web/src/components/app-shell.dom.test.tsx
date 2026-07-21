// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

vi.mock("@/app/actions/conversational-capture", () => ({
  addCapturePersonAction: vi.fn(),
  captureExplicitOutcomeAction: vi.fn(),
  changeExplicitCaptureOutcomeAction: vi.fn(),
  undoExplicitCaptureOutcomeAction: vi.fn(),
}));

import { AppShell } from "./app-shell";

describe("AppShell Phase Seven mobile navigation", () => {
  it("uses exactly the five selected phone destinations and keeps domain links in Menu", async () => {
    const user = userEvent.setup();
    render(
      <AppShell mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    const mobileNav = screen.getByRole("navigation", { name: "Mobile primary" });
    expect(
      [...mobileNav.querySelectorAll("a, button")].map((item) => item.textContent?.trim()),
    ).toEqual(["Today", "Search", "Capture", "Review", "Menu"]);
    expect(screen.queryByText(/items? to review/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Capture" }).className).toMatch(/font-medium/);
    for (const control of mobileNav.querySelectorAll("a, button")) {
      expect(control.className).toContain("min-h-16");
    }

    await user.click(screen.getByRole("button", { name: "Menu" }));
    for (const name of ["People", "Actions", "Assets", "Saved Items", "Account"]) {
      expect(screen.getByRole("link", { name })).toBeDefined();
    }
  });

  it("marks Review as the active phone destination without adding a count", () => {
    render(
      <AppShell mobileReview ownerUserId="owner-1">
        <p>Review queue</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Review" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens focused flows without the bottom bar and restores invoking focus and surface state", async () => {
    const user = userEvent.setup();
    render(
      <AppShell mobileHome ownerUserId="owner-1">
        <input aria-label="Desktop state" defaultValue="still here" />
      </AppShell>,
    );

    const searchButton = screen.getByRole("button", { name: "Search" });
    searchButton.focus();
    await user.click(searchButton);

    expect(screen.getByRole("dialog", { name: "Search" })).toBeDefined();
    expect(screen.queryByRole("navigation", { name: "Mobile primary" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search Tendnote" })).toBe(document.activeElement);
    expect(screen.getByRole("button", { name: "Back to Today" }).className).toContain("size-11");
    expect(screen.getByRole("dialog", { name: "Search" }).className).toContain("h-dvh");

    await user.type(screen.getByRole("textbox", { name: "Search Tendnote" }), "air filter");

    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    await waitFor(() => expect(searchButton).toBe(document.activeElement));
    expect(screen.getByDisplayValue("still here")).toBeDefined();
    await user.click(searchButton);
    expect(screen.getByDisplayValue("air filter")).toBeDefined();
  });

  it("renders the selected shaded Today band and a reserved flat Personal Ledger region", () => {
    const { container } = render(
      <AppShell mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { name: "Today" })).toBeDefined();
    expect(screen.getByTestId("today-orientation-band").className).toContain("bg-panel");
    expect(screen.getByRole("textbox", { name: "Ask Eve anything" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Eve" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Today shortlist" })).toBeDefined();
    expect(container.querySelectorAll("[data-today-ledger-row]")).toHaveLength(3);
  });

  it("keeps the compact Today Eve composer usable before opening the focused flow", async () => {
    const user = userEvent.setup();
    render(
      <AppShell mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.type(screen.getByRole("textbox", { name: "Ask Eve anything" }), "What is due?");
    await user.click(screen.getByRole("button", { name: "Send to Eve" }));
    expect(screen.getByRole("dialog", { name: "Eve" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    expect(screen.getByDisplayValue("What is due?")).toBeDefined();
  });

  it("restores one visibly unsaved Capture draft, then clears it on discard", async () => {
    const user = userEvent.setup();
    render(
      <AppShell mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    const input = screen.getByRole("textbox", { name: "What should Tendnote keep?" });
    await user.type(input, "Remember the air filter size");
    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    await user.click(screen.getByRole("button", { name: "Capture" }));

    expect(screen.getByText("Unsaved draft restored on this device.")).toBeDefined();
    expect(screen.getByDisplayValue("Remember the air filter size")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(
      (screen.getByRole("textbox", { name: "What should Tendnote keep?" }) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });

  it("clears the Capture draft only after a successful submission", async () => {
    const user = userEvent.setup();
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    render(
      <AppShell
        captureHandlers={{
          change: vi.fn(),
          submit: async () => ({ confirmation }),
          undo: vi.fn(),
        }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Remember the serial number",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(await screen.findByRole("heading", { name: "Capture saved" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    await user.click(screen.getByRole("button", { name: "Capture" }));
    expect(screen.queryByText("Unsaved draft restored on this device.")).toBeNull();
  });

  it("continues one source-first clarification with the same interaction and original wording", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockResolvedValueOnce({
        clarification: {
          field: "timing" as const,
          question: "When should I remind you to replace the filter?",
          sourceRecordId: "source-1",
        },
      })
      .mockResolvedValueOnce({
        confirmation: {
          destination: "Actions" as const,
          groundedBySourceRecordId: "source-1",
          interpreted: {
            title: "Replace the filter",
            dueAt: "2026-07-22T14:00:00.000Z",
            cadence: null,
            scope: "Only me" as const,
          },
          change: { kind: "edit_general_action" as const, generalActionId: "action-1" },
          undo: { kind: "archive_general_action" as const, generalActionId: "action-1" },
        },
      });
    render(
      <AppShell
        captureHandlers={{ change: vi.fn(), submit, undo: vi.fn() }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Remind me to replace the filter sometime",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(
      await screen.findByRole("textbox", {
        name: "When should I remind you to replace the filter?",
      }),
    ).toBeDefined();
    expect(screen.getByText("Original capture retained as source evidence")).toBeDefined();
    await user.type(
      screen.getByRole("textbox", { name: "When should I remind you to replace the filter?" }),
      "tomorrow",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Capture saved" })).toBeDefined();
    expect(screen.getAllByText("Actions")).toHaveLength(2);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0]).toMatchObject({
      clarificationAnswer: "tomorrow",
      interactionId: submit.mock.calls[0]?.[0].interactionId,
      originalText: "Remind me to replace the filter sometime",
    });
  });

  it("offers Add and Link actions for an unknown Follow-Up person", async () => {
    const user = userEvent.setup();
    const clarification = {
      field: "person" as const,
      question: "Who did you mean by Maya?",
      sourceRecordId: "source-1",
      actions: [
        { kind: "add_person" as const, label: "Add Maya", displayName: "Maya" },
        { kind: "link_person" as const, label: "Link someone else" as const },
      ],
    };
    const confirmation = {
      destination: "Follow-Ups" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { person: "Maya", dueAt: "2026-07-21T14:00:00.000Z", scope: "Only me" as const },
      change: { kind: "edit_followup" as const, followupId: "followup-1" },
      undo: { kind: "archive_followup" as const, followupId: "followup-1" },
    };
    const addPerson = vi.fn().mockResolvedValue({ displayName: "Maya" });
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ clarification })
      .mockResolvedValueOnce({ confirmation });
    render(
      <AppShell
        captureHandlers={{
          addPerson,
          change: vi.fn(),
          submit,
          undo: vi.fn(),
        }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Remind me to follow up with Maya tomorrow",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(await screen.findByRole("button", { name: "Link someone else" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Add Maya" }));

    expect(addPerson).toHaveBeenCalledWith({ displayName: "Maya" });
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clarificationAnswer: "Maya",
        originalText: "Remind me to follow up with Maya tomorrow",
      }),
    );
    expect(await screen.findByText("Follow-Up with Maya")).toBeDefined();
  });

  it("replaces confirmation controls when Change reroutes to a new destination", async () => {
    const user = userEvent.setup();
    const savedConfirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const actionConfirmation = {
      destination: "Actions" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: {
        title: "Replace the filter",
        dueAt: null,
        cadence: null,
        scope: "Only me" as const,
      },
      change: { kind: "edit_general_action" as const, generalActionId: "action-1" },
      undo: { kind: "archive_general_action" as const, generalActionId: "action-1" },
    };
    const change = vi.fn().mockResolvedValue({ confirmation: actionConfirmation });
    const undo = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AppShell
        captureHandlers={{
          change,
          submit: vi.fn().mockResolvedValue({ confirmation: savedConfirmation }),
          undo,
        }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "The filter needs replacing",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    await user.click(await screen.findByRole("button", { name: "Change" }));
    const correction = screen.getByRole("textbox", { name: "Change saved wording" });
    await user.clear(correction);
    await user.type(correction, "I need to replace the filter");
    await user.click(screen.getByRole("button", { name: "Save change" }));

    await waitFor(() => expect(screen.getAllByText("Actions")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledWith({
      target: { kind: "archive_general_action", generalActionId: "action-1" },
    });
  });

  it("shows and completes a focused clarification returned by Change", async () => {
    const user = userEvent.setup();
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const change = vi
      .fn()
      .mockResolvedValueOnce({
        clarification: {
          field: "timing" as const,
          question: "When should I remind you to replace the filter?",
          sourceRecordId: "source-1",
        },
      })
      .mockResolvedValueOnce({ confirmation });
    render(
      <AppShell
        captureHandlers={{
          change,
          submit: vi.fn().mockResolvedValue({ confirmation }),
          undo: vi.fn().mockResolvedValue({ ok: true }),
        }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(screen.getByRole("textbox", { name: "What should Tendnote keep?" }), "Note");
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    await user.click(await screen.findByRole("button", { name: "Change" }));
    const correction = screen.getByRole("textbox", { name: "Change saved wording" });
    await user.clear(correction);
    await user.type(correction, "Remind me to replace the filter sometime");
    await user.click(screen.getByRole("button", { name: "Save change" }));

    const answer = await screen.findByRole("textbox", {
      name: "When should I remind you to replace the filter?",
    });
    await user.type(answer, "tomorrow");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(change).toHaveBeenLastCalledWith({
      clarificationAnswer: "tomorrow",
      target: confirmation.change,
      originalText: "Remind me to replace the filter sometime",
    });
  });

  it("keeps one interaction id across a failed retry and shows grounded Change and Undo controls", async () => {
    const user = userEvent.setup();
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Open question" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ confirmation });
    const change = vi.fn().mockResolvedValue({ ok: true });
    const undo = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AppShell captureHandlers={{ change, submit, undo }} mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.click(screen.getByRole("button", { name: "Dictated transcript" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Where can I buy this filter?",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(await screen.findByDisplayValue("Where can I buy this filter?")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Capture wasn't saved" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Try saving again" }));
    expect(await screen.findByText("Original capture retained as source evidence")).toBeDefined();
    expect(screen.getByText("Open question")).toBeDefined();
    expect(screen.getByText("Only me")).toBeDefined();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0].interactionId).toBe(submit.mock.calls[0]?.[0].interactionId);
    expect(submit.mock.calls[1]?.[0].inputMode).toBe("dictated");

    await user.click(screen.getByRole("button", { name: "Change" }));
    const changeInput = screen.getByRole("textbox", { name: "Change saved wording" });
    await user.clear(changeInput);
    await user.type(changeInput, "Where should I buy this filter?");
    await user.click(screen.getByRole("button", { name: "Save change" }));
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        target: { kind: "edit_saved_item", savedItemId: "saved-1" },
        originalText: "Where should I buy this filter?",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("heading", { name: "Capture undone" })).toBeDefined();
    expect(undo).toHaveBeenCalledWith({
      target: { kind: "archive_saved_item", savedItemId: "saved-1" },
    });
  });

  it("adds a live dictated transcript without retaining audio provenance", async () => {
    const user = userEvent.setup();
    const stopRecognition = vi.fn();
    let recognition:
      | {
          onend: (() => void) | null;
          onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
        }
      | undefined;
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null =
        null;
      constructor() {
        recognition = this;
      }
      start() {}
      stop() {
        stopRecognition();
        this.onend?.();
      }
    }
    Object.defineProperty(globalThis, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const submit = vi.fn().mockResolvedValue({ confirmation });
    render(
      <AppShell
        captureHandlers={{ change: vi.fn(), submit, undo: vi.fn() }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.click(screen.getByRole("button", { name: "Start dictation" }));
    recognition?.onresult?.({ results: [{ 0: { transcript: "Remember filter model 9000" } }] });
    recognition?.onend?.();
    expect(await screen.findByDisplayValue("Remember filter model 9000")).toBeDefined();
    expect(screen.getByText("Dictated transcript added.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMode: "dictated",
        originalText: "Remember filter model 9000",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    expect(stopRecognition).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(globalThis, "webkitSpeechRecognition");
  });

  it("starts a distinct interaction after discarding a failed capture", async () => {
    const user = userEvent.setup();
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-2",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-2" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-2" },
    };
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("ambiguous failure"))
      .mockResolvedValueOnce({ confirmation });
    render(
      <AppShell
        captureHandlers={{ change: vi.fn(), submit, undo: vi.fn() }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    const input = screen.getByRole("textbox", { name: "What should Tendnote keep?" });
    await user.type(input, "First draft");
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(await screen.findByRole("heading", { name: "Capture wasn't saved" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(screen.queryByRole("heading", { name: "Capture wasn't saved" })).toBeNull();
    await user.type(input, "Separate draft");
    await user.click(screen.getByRole("button", { name: "Save capture" }));

    expect(submit.mock.calls[1]?.[0].interactionId).not.toBe(
      submit.mock.calls[0]?.[0].interactionId,
    );
    expect(await screen.findByRole("heading", { name: "Capture saved" })).toBeDefined();
  });

  it("never turns a failed Change retry into Undo after Cancel", async () => {
    const user = userEvent.setup();
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const change = vi.fn().mockRejectedValue(new Error("change failed"));
    const undo = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AppShell
        captureHandlers={{ change, submit: vi.fn().mockResolvedValue({ confirmation }), undo }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Original note",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("button", { name: "Save change" }));
    expect(await screen.findByRole("heading", { name: "Change wasn't saved" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Try change again" })).toBeNull();
    expect(undo).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
