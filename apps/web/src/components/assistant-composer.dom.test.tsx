// @vitest-environment jsdom
import type { ChatStatus } from "ai";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * The composer's two promises to the person typing into it.
 *
 * 1. **The submit says what it can do.** It is Send when there is something to
 *    send, Stop while a turn runs, and plainly inert on an empty line — and an
 *    inert one never swallows an Enter into an empty submission.
 * 2. **A file gets in without the menu.** Pasting an image routes into the same
 *    Asset Evidence capture the "+" menu opens (ADR 0185); it never lands in
 *    `PromptInput`'s own attachment store, and pasted *text* is left alone.
 */

vi.mock("@/app/actions/asset-evidence", () => ({
  addAssetEvidenceAction: vi.fn(),
  addAssetEvidenceToNewAssetAction: vi.fn(),
  listAssetEvidenceDestinationsAction: vi.fn(() => Promise.resolve([])),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { useEvidencePick } from "@/lib/eve/evidence-pick";
import { PromptInputProvider } from "./ai-elements/prompt-input";
import { AssistantComposerForm } from "./assistant-composer";

const onStop = vi.fn();
const onSubmit = vi.fn(() => Promise.resolve());

beforeEach(() => {
  onStop.mockClear();
  onSubmit.mockClear();
  window.localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

/**
 * The composer with the evidence state the panel normally owns, so the pick, the
 * chip, and the capture panel behave here exactly as they do on the dashboard.
 */
function Composer({ status }: { status: ChatStatus }) {
  const evidence = useEvidencePick();
  return (
    <AssistantComposerForm
      evidence={evidence}
      onStop={onStop}
      onSubmit={onSubmit}
      ownerUserId="owner-1"
      status={status}
      textareaRef={{ current: null }}
    />
  );
}

function mount(status: ChatStatus = "ready") {
  return render(
    <PromptInputProvider>
      <Composer status={status} />
    </PromptInputProvider>,
  );
}

/**
 * The composer's own textarea, by placeholder: once a capture panel is open the
 * page holds several textboxes, and only this one is the message.
 */
function composer(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(
    "Remember something from a conversation today…",
  ) as HTMLTextAreaElement;
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
}

/** Whether the submit is showing its inert treatment. */
function submitInert(name = "Submit"): boolean {
  return (
    (screen.getByRole("button", { name }) as HTMLButtonElement).getAttribute("aria-disabled") ===
    "true"
  );
}

function png(name = "receipt.png"): File {
  return new File([new Uint8Array(4)], name, { type: "image/png" });
}

/** A paste carrying files, which jsdom's own clipboard cannot express. */
function pasteFiles(files: File[]): void {
  fireEvent.paste(composer(), { clipboardData: { files, getData: () => "" } });
}

it("offers nothing to press on an empty line, and swallows the Enter that would send it", async () => {
  mount("ready");

  expect(submitInert()).toBe(true);
  // Never the native attribute: `InputGroup` fades to 50% around any disabled
  // descendant, which would dim the textarea the user has to type into to make
  // the button live again.
  expect(submitButton().disabled).toBe(false);

  await userEvent.type(composer(), "   {Enter}");

  expect(onSubmit).not.toHaveBeenCalled();
  expect(submitInert()).toBe(true);
});

it("comes alive on the first character the user types, and goes back when it is deleted", async () => {
  mount("ready");

  await userEvent.type(composer(), "Mara");
  expect(submitInert()).toBe(false);

  await userEvent.clear(composer());
  expect(submitInert()).toBe(true);
});

it("is live with a file in hand and no words, because the file is the message", async () => {
  mount("ready");

  pasteFiles([png()]);

  await waitFor(() => expect(submitInert()).toBe(false));
  expect(composer().value).toBe("");
});

it("is Stop while a turn runs, whether or not anything is typed", async () => {
  mount("streaming");

  expect(submitInert("Stop")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));

  expect(onStop).toHaveBeenCalledOnce();
});

it("stays live for the queue when a line is typed during a turn", async () => {
  mount("submitted");

  // `submitted` renders the spinner, and the control is still the way a queued
  // message gets in - it is never the empty-composer treatment.
  await userEvent.type(composer(), "and she adopted a cat");

  expect(submitInert("Stop")).toBe(false);
});

it("routes a pasted image into the shared evidence capture, as a chip and a panel", async () => {
  mount("ready");

  pasteFiles([png("dishwasher.png")]);

  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Attach asset evidence" })).toBeTruthy(),
  );
  expect(screen.getAllByText("dishwasher.png").length).toBeGreaterThan(0);
  // The turn never sees it: nothing was handed to `onSubmit`, and the chip is a
  // marker rather than an attachment.
  expect(onSubmit).not.toHaveBeenCalled();
});

it("takes the first supported paste and says so, rather than opening two captures", async () => {
  mount("ready");

  pasteFiles([png("first.png"), png("second.png")]);

  await waitFor(() =>
    expect(screen.getByText("One file at a time. Using the first.")).toBeTruthy(),
  );
  expect(screen.getAllByText("first.png").length).toBeGreaterThan(0);
  expect(screen.queryByText("second.png")).toBeNull();
});

it("names the kinds it takes when the paste is not one of them, without opening a capture", async () => {
  mount("ready");

  pasteFiles([new File([new Uint8Array(4)], "photos.zip", { type: "application/zip" })]);

  await waitFor(() =>
    expect(screen.getByText("Use a JPEG, PNG, WebP, HEIC, or PDF file.")).toBeTruthy(),
  );
  expect(screen.queryByRole("region", { name: "Attach asset evidence" })).toBeNull();
});

it("retires the note as soon as the user goes back to typing", async () => {
  mount("ready");

  pasteFiles([new File([new Uint8Array(4)], "photos.zip", { type: "application/zip" })]);
  await waitFor(() =>
    expect(screen.getByText("Use a JPEG, PNG, WebP, HEIC, or PDF file.")).toBeTruthy(),
  );

  await userEvent.type(composer(), "M");

  expect(screen.queryByText("Use a JPEG, PNG, WebP, HEIC, or PDF file.")).toBeNull();
});

it("leaves a text paste entirely alone", async () => {
  mount("ready");

  await userEvent.click(composer());
  await userEvent.paste("Mara adopted a cat");

  expect(composer().value).toBe("Mara adopted a cat");
  expect(screen.queryByRole("region", { name: "Attach asset evidence" })).toBeNull();
  expect(submitInert()).toBe(false);
});
