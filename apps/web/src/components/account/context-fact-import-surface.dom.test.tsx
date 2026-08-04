// @vitest-environment jsdom

import type { ContextFactView } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelfContextImportView } from "@/lib/context-fact-import-view";
import type { SuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const acceptSuggestedContextFactAction = vi.fn();
const dismissSuggestedContextFactAction = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/actions/context-fact-review", () => ({
  acceptSuggestedContextFactAction: (...args: unknown[]) =>
    acceptSuggestedContextFactAction(...args),
  dismissSuggestedContextFactAction: (...args: unknown[]) =>
    dismissSuggestedContextFactAction(...args),
}));

vi.mock("@/app/actions/context-fact-import", () => ({
  importSelfContextFactsAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// The suggestion cards open Radix `Select`s once edited, which reach for pointer
// capture and scroll positioning jsdom does not implement.
HTMLElement.prototype.scrollIntoView ??= vi.fn();
HTMLElement.prototype.hasPointerCapture ??= vi.fn();
HTMLElement.prototype.releasePointerCapture ??= vi.fn();

import { ContextFactImportSurface } from "./context-fact-import-surface";

const NOW = new Date("2026-08-03T12:00:00.000Z");
const PROMPT = "Ask your assistant.";
const BLOCK_MARKER = "```tendnote-context";
const PASTE = [BLOCK_MARKER, "work | normal | I run a software consultancy.", "```"].join("\n");

const OPTIONS = [
  { id: "chatgpt" as const, name: "ChatGPT", href: "https://chatgpt.com/?q=x", prefilled: true },
  { id: "claude" as const, name: "Claude", href: "https://claude.ai/new", prefilled: false },
  {
    id: "gemini" as const,
    name: "Gemini",
    href: "https://gemini.google.com/app",
    prefilled: false,
  },
];

function fact(overrides: Partial<ContextFactView> = {}): ContextFactView {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    subject: { kind: "self" },
    category: "work",
    content: "I run a software consultancy.",
    lifecycle: "suggested",
    sensitivity: "normal",
    provenance: { channel: "import", origin: "import" },
    reviewedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    trust: "untrusted_data",
    authority: "none",
    visibility: "private",
    ...overrides,
  };
}

function review(overrides: Partial<ContextFactView> = {}): SuggestedContextFactReviewView {
  return {
    fact: fact(overrides),
    evidence: 'From your ChatGPT memory: "I run a software consultancy."',
    activeMatch: null,
  };
}

function importedView(
  overrides: Partial<SelfContextImportView["summary"]> = {},
): SelfContextImportView {
  return {
    summary: {
      importId: "00000000-0000-4000-8000-0000000000ff",
      provider: "chatgpt",
      source: "block",
      suggestedCount: 1,
      alreadyPendingCount: 0,
      skippedCount: 0,
      unreadableCount: 0,
      readByModel: false,
      ...overrides,
    },
    reviews: [review()],
  };
}

function renderSurface(importAction = vi.fn()) {
  render(
    <ContextFactImportSurface
      backHref="/account/about-you"
      backLabel="Back to About you"
      importAction={importAction}
      maxTextLength={16_000}
      options={OPTIONS}
      prompt={PROMPT}
    />,
  );
  return { importAction };
}

function pasteBox() {
  return screen.getByLabelText("What the assistant said") as HTMLTextAreaElement;
}

async function paste(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(pasteBox());
  await user.paste(text);
}

async function readPaste(user: ReturnType<typeof userEvent.setup>, provider: RegExp, text = PASTE) {
  await user.click(screen.getByRole("button", { name: provider }));
  await paste(user, text);
  await user.click(screen.getByRole("button", { name: "Read this paste" }));
}

/** An import with two keepable rows reviewed and its bulk keep button in reach. */
async function bulkKeepReady(
  user: ReturnType<typeof userEvent.setup>,
  extraReviews: SuggestedContextFactReviewView[] = [],
) {
  const view = importedView({ suggestedCount: 2 + extraReviews.length });
  view.reviews = [
    review(),
    review({ id: "00000000-0000-4000-8000-000000000003", content: "I am based in Chicago." }),
    ...extraReviews,
  ];
  renderSurface(vi.fn().mockResolvedValue({ ok: true, view }));
  await readPaste(user, /ChatGPT/);
  return screen.findByRole("button", { name: "Keep the 2 without conflicts" });
}

describe("ContextFactImportSurface", () => {
  // Stands in for the real WindowProxy: `opener` has to be settable, because that
  // is how the handoff severs it without giving up the did-it-open answer.
  let opened: { opener: Window | null };

  beforeEach(() => {
    vi.clearAllMocks();
    opened = { opener: window };
    vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);
  });

  it("offers all three assistants and says what each button will do", () => {
    renderSurface();

    expect(screen.getByRole("button", { name: /ChatGPT/ }).textContent).toContain(
      "Opens with the prompt ready",
    );
    expect(screen.getByRole("button", { name: /Claude/ }).textContent).toContain(
      "Copies the prompt, then opens",
    );
    expect(screen.getByRole("button", { name: /Gemini/ })).toBeTruthy();
  });

  it("copies the prompt and opens the assistant from one click", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.click(screen.getByRole("button", { name: /Claude/ }));

    expect(await navigator.clipboard.readText()).toBe(PROMPT);
    // No `noopener` in the feature string: it forces a null return even on success,
    // which would report every working handoff as a blocked popup. The opener is
    // severed on the handle instead.
    expect(window.open).toHaveBeenCalledWith("https://claude.ai/new", "_blank");
    expect(opened.opener).toBeNull();
    expect((await screen.findByText(/Paste it into Claude and send it/)).textContent).toBeTruthy();
  });

  it("does not describe a click the owner has already moved on from", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.click(screen.getByRole("button", { name: /ChatGPT/ }));
    await user.click(screen.getByRole("button", { name: /Claude/ }));

    // Whichever clipboard write settles last, the visible line has to describe the
    // provider that is actually selected.
    expect(await screen.findByText(/Paste it into Claude and send it/)).toBeTruthy();
    expect(screen.queryByText(/ChatGPT opened/)).toBeNull();
  });

  it("says the prompt is still on the clipboard when the tab is blocked", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "open").mockReturnValue(null);
    renderSurface();

    await user.click(screen.getByRole("button", { name: /ChatGPT/ }));

    expect(await screen.findByText(/your browser may have blocked the new tab/)).toBeTruthy();
  });

  it("shows the prompt on request, so nothing reaches a third party unseen", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.click(screen.getByRole("button", { name: "See the prompt" }));

    expect(await screen.findByText(PROMPT)).toBeTruthy();
  });

  it("tells the owner a known format never leaves the app", async () => {
    const user = userEvent.setup();
    renderSurface();

    await paste(user, PASTE);

    expect(screen.getByText(/your paste never leaves the app/)).toBeTruthy();
  });

  it("warns that loose prose will reach the extraction model", async () => {
    const user = userEvent.setup();
    renderSurface();

    await paste(user, "You run a software consultancy.");

    expect(screen.getByText(/read this with its extraction model/)).toBeTruthy();
  });

  it("does not promise local reading for a block the import would not read", async () => {
    const user = userEvent.setup();
    renderSurface();

    // The fence is there but no line parses, so the import falls through to the
    // model. Promising otherwise would be a lie about where this paste is going.
    await paste(user, [BLOCK_MARKER, "I run a software consultancy.", "```"].join("\n"));

    expect(screen.queryByText(/your paste never leaves the app/)).toBeNull();
    expect(screen.getByText(/read this with its extraction model/)).toBeTruthy();
  });

  it("asks which assistant a paste came from rather than guessing", async () => {
    const user = userEvent.setup();
    const { importAction } = renderSurface(
      vi.fn().mockResolvedValue({ ok: true, view: importedView() }),
    );

    await paste(user, PASTE);
    expect(
      (screen.getByRole("button", { name: "Read this paste" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: /^Gemini$/ }));
    await user.click(screen.getByRole("button", { name: "Read this paste" }));

    await waitFor(() => {
      expect(importAction).toHaveBeenCalledWith({ provider: "gemini", text: PASTE });
    });
  });

  it("uses the assistant the owner opened without asking again", async () => {
    const user = userEvent.setup();
    const { importAction } = renderSurface(
      vi.fn().mockResolvedValue({ ok: true, view: importedView() }),
    );

    await user.click(screen.getByRole("button", { name: /Claude/ }));
    await paste(user, PASTE);

    expect(screen.queryByText("Which assistant is this from?")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Read this paste" }));

    await waitFor(() => {
      expect(importAction).toHaveBeenCalledWith({ provider: "claude", text: PASTE });
    });
  });

  it("hands every imported fact to review instead of keeping it outright", async () => {
    const user = userEvent.setup();
    renderSurface(vi.fn().mockResolvedValue({ ok: true, view: importedView() }));

    await readPaste(user, /ChatGPT/);

    expect(await screen.findByText("1 fact from ChatGPT to review.")).toBeTruthy();
    expect(screen.getByText(/never left your notebook/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });

  it("names what an import held back rather than dropping it silently", async () => {
    const user = userEvent.setup();
    renderSurface(
      vi.fn().mockResolvedValue({
        ok: true,
        view: importedView({ skippedCount: 2, unreadableCount: 1 }),
      }),
    );

    await readPaste(user, /ChatGPT/);

    expect(await screen.findByText("2 facts you dismissed before stayed dismissed.")).toBeTruthy();
    expect(screen.getByText("1 line could not be read as a fact and was left out.")).toBeTruthy();
  });

  it("teaches the next step when a paste yields nothing", async () => {
    const user = userEvent.setup();
    renderSurface(
      vi.fn().mockResolvedValue({
        ok: true,
        view: {
          summary: {
            importId: "00000000-0000-4000-8000-0000000000ff",
            provider: "gemini" as const,
            source: "extraction" as const,
            suggestedCount: 0,
            alreadyPendingCount: 0,
            skippedCount: 0,
            unreadableCount: 0,
            readByModel: true,
          },
          reviews: [],
        },
      }),
    );

    await readPaste(user, /Gemini/, "Nothing durable here.");

    expect(await screen.findByText("No facts came through.")).toBeTruthy();
    expect(screen.getByText(/hold it to the code block/)).toBeTruthy();
  });

  it("keeps the paste in the box when reading fails", async () => {
    const user = userEvent.setup();
    renderSurface(vi.fn().mockResolvedValue({ ok: false, error: "Budget exhausted." }));

    await readPaste(user, /ChatGPT/);

    expect((await screen.findByRole("alert")).textContent).toBe("Budget exhausted.");
    expect(pasteBox().value).toBe(PASTE);
  });

  it("reads the clipboard into the box on request", async () => {
    const user = userEvent.setup();
    renderSurface();
    await navigator.clipboard.writeText(PASTE);

    await user.click(screen.getByRole("button", { name: "Paste from clipboard" }));

    await waitFor(() => {
      expect(pasteBox().value).toBe(PASTE);
    });
  });

  it("falls back to manual pasting when the clipboard cannot be read", async () => {
    const user = userEvent.setup();
    renderSurface();
    vi.spyOn(navigator.clipboard, "readText").mockRejectedValue(new Error("denied"));

    await user.click(screen.getByRole("button", { name: "Paste from clipboard" }));

    expect(
      await screen.findByText(/could not read your clipboard. Paste into the box instead/),
    ).toBeTruthy();
  });

  it("offers bulk keep only for the facts with nothing to weigh", async () => {
    const user = userEvent.setup();
    const conflicting = review({ id: "00000000-0000-4000-8000-000000000002" });
    conflicting.activeMatch = { kind: "conflict", fact: fact({ lifecycle: "active" }) };
    acceptSuggestedContextFactAction.mockResolvedValue({ ok: true, view: { fact: fact() } });

    await user.click(await bulkKeepReady(user, [conflicting]));

    await waitFor(() => {
      expect(acceptSuggestedContextFactAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByRole("button", { name: /Keep the/ })).toBeNull();
  });

  it("shows an over-long paste rather than truncating it away", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.click(screen.getByRole("button", { name: /ChatGPT/ }));
    await paste(user, "x".repeat(16_050));

    // The whole paste is still in the box: a silently trimmed tail would leave the
    // owner reviewing a partial import that looked complete.
    expect(pasteBox().value).toHaveLength(16_050);
    expect(screen.getByText(/more than one import can carry/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Read this paste" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("retracts a failed read once the owner edits the paste", async () => {
    const user = userEvent.setup();
    renderSurface(vi.fn().mockResolvedValue({ ok: false, error: "Budget exhausted." }));

    await readPaste(user, /ChatGPT/);
    expect((await screen.findByRole("alert")).textContent).toBe("Budget exhausted.");

    await user.type(pasteBox(), " more");

    // The message described content the owner has now replaced, so it goes with it.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(pasteBox().getAttribute("aria-invalid")).toBeNull();
  });

  it("holds the cards inert while a bulk keep works through them", async () => {
    const user = userEvent.setup();
    // The first accept is held open so the assertions land mid-pass.
    let releaseFirst: (() => void) | undefined;
    acceptSuggestedContextFactAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ ok: true, view: { fact: fact() } });
        }),
    );
    acceptSuggestedContextFactAction.mockResolvedValue({ ok: true, view: { fact: fact() } });

    await user.click(await bulkKeepReady(user));

    // Mid-pass: the owner must not be able to start a second decision on a row the
    // loop is about to take, which would fail on a stale timestamp.
    await waitFor(() => {
      expect(
        (screen.getAllByRole("button", { name: "Accept" })[0] as HTMLButtonElement).disabled,
      ).toBe(true);
    });
    releaseFirst?.();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Keep the/ })).toBeNull();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("returns the owner to where they came from", () => {
    renderSurface();

    expect(screen.getByRole("link", { name: "Back to About you" }).getAttribute("href")).toBe(
      "/account/about-you",
    );
  });
});
