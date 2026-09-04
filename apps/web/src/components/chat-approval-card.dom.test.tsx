// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  AssistantApprovalPolicyProvider,
  type EveApprovalMode,
} from "@/components/assistant-approval-policy-context";
import { AssistantRespondProvider } from "@/components/assistant-respond-context";
import {
  ChatApprovalBatchCard,
  ChatApprovalCard,
  ChatApprovalStatus,
} from "@/components/chat-approval-card";
import {
  type RecordSessionToolTrust,
  SessionToolTrustProvider,
} from "@/components/session-tool-trust-context";
import type {
  AssistantInputRequestView,
  AssistantInputResolutionView,
} from "@/lib/eve/input-request-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

vi.mock("@/app/actions/approval-subjects", () => ({
  describeApprovalSubjectAction: vi.fn(),
}));

import { describeApprovalSubjectAction } from "@/app/actions/approval-subjects";
import { resetApprovalSubjectCache } from "@/lib/approval-subject-cache";

const describeSubject = vi.mocked(describeApprovalSubjectAction);

beforeEach(() => {
  // The lookup cache deliberately outlives every component that reads it, so a suite
  // reusing a `toolCallId` has to start from nothing.
  resetApprovalSubjectCache();
  describeSubject.mockReset();
  // Default: a lookup that never lands. That is the state most of these tests are
  // actually about - the card as it renders before any description arrives - and it
  // keeps a resolving promise from settling after the test that started it.
  describeSubject.mockReturnValue(new Promise(() => {}));
});

/**
 * The approval card is the one control in the conversation where a click *is* the
 * authorization: it resumes a turn eve has parked on the owner, and the answer never
 * passes through the model. So these tests pin what a drifting UI would quietly get
 * wrong — that the owner sees the real action, that the answer carries the ids eve
 * asked for, and that a decision cannot be sent twice.
 *
 * The fixture is eve 0.47.7's actual request: a fixed placeholder prompt, unstyled
 * `approve` / `cancel` options, and the whole substance in the frozen input.
 */

/** The disclosure that unfolds the frozen input, by its label. */
const SHOW_FULL_REQUEST = "Show the full request";

const FETCH_REQUEST: AssistantInputRequestView = {
  requestId: "req-1",
  toolCallId: "call-1",
  toolName: "web_fetch",
  kind: "tool-approval",
  prompt: "Approve tool call: web_fetch",
  display: "confirmation",
  allowFreeform: false,
  options: [
    { id: "approve", label: "Approve", description: null, style: "default" },
    { id: "cancel", label: "Cancel", description: null, style: "default" },
  ],
  fields: [
    {
      key: "url",
      value: "https://example.com/articles/tea-ceremony",
      block: false,
    },
  ],
  input: { url: "https://example.com/articles/tea-ceremony" },
};

function renderCard(
  request: AssistantInputRequestView,
  {
    ready = true,
    respond = vi.fn(async () => {}),
  }: {
    ready?: boolean;
    respond?: (responses: readonly unknown[]) => Promise<void>;
  } = {},
) {
  render(
    <AssistantRespondProvider
      ready={ready}
      respond={respond as (responses: readonly { requestId: string }[]) => Promise<void>}
    >
      <ChatApprovalCard request={request} />
    </AssistantRespondProvider>,
  );
  return respond;
}

/** A registry answer, in the shape the Server Action returns it. */
function described(title: string, lines: readonly string[] = []) {
  return { ok: true as const, view: { kind: "described" as const, subject: { title, lines } } };
}

/**
 * The load-bearing one. eve's approval prompt is the fixed string "Approve tool call:
 * <toolName>" and the browser's copy of the request carries no input at all, so a card
 * that showed the prompt would be asking the owner to authorize a sentence with no
 * object. What is about to happen exists only in the frozen call.
 */
it("shows the tool and the exact arguments it is frozen with, not eve's placeholder prompt", () => {
  renderCard(FETCH_REQUEST);

  expect(screen.getByText("The assistant wants to run web fetch.")).toBeDefined();
  expect(screen.getByText("url")).toBeDefined();
  expect(screen.getByText("https://example.com/articles/tea-ceremony")).toBeDefined();
  expect(screen.queryByText(/Approve tool call:/)).toBeNull();
});

it("shows a question's own words, which are the model's and do carry meaning", () => {
  renderCard({
    ...FETCH_REQUEST,
    kind: "question",
    prompt: "Which Mara did you mean?\nThere are two in your notebook.",
    fields: [],
  });

  const prompt = screen.getByText(/Which Mara did you mean\?/);
  expect(prompt.textContent).toBe("Which Mara did you mean?\nThere are two in your notebook.");
  expect(prompt.className).toContain("whitespace-pre-line");
});

it("offers exactly the options eve sent, by their own labels", () => {
  renderCard(FETCH_REQUEST);

  expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  expect(screen.getAllByRole("button")).toHaveLength(2);
});

/**
 * The framework sends no style hint for an approval. The card must not supply one:
 * a sage-filled Approve beside a plain Cancel is the interface arguing for yes.
 */
it("gives neither answer more weight than the other", () => {
  renderCard(FETCH_REQUEST);

  const approve = screen.getByRole("button", { name: "Approve" });
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(approve.getAttribute("data-variant")).toBe(cancel.getAttribute("data-variant"));
  expect(approve.getAttribute("data-variant")).not.toBe("default");
});

/**
 * The card interrupts a conversation, so its height is part of whether it gets read.
 * These pin the composition that keeps it short: no sentence repeats what the chip and
 * the live buttons already say, the state chip labels the heading instead of standing
 * on a line of its own, and no row exists only to hold the buttons (below, where the
 * request that has something to disclose is defined).
 */
it("carries the wait in the chip and the live buttons, not a standing footer sentence", () => {
  renderCard(FETCH_REQUEST);

  expect(screen.getByText("Needs your approval")).toBeDefined();
  expect(screen.queryByText(/Nothing happens until you choose/)).toBeNull();
  expect(screen.queryByText(/Eve is waiting/)).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("labels the heading with the state chip on one row", () => {
  renderCard(FETCH_REQUEST);

  const header = document.querySelector("[data-slot=approval-header]");
  expect(header?.contains(screen.getByText("Needs your approval"))).toBe(true);
  expect(header?.contains(screen.getByText("The assistant wants to run web fetch."))).toBe(true);
});

it("keeps a long or nested argument out of the way until it is asked for", async () => {
  const note = "x".repeat(400);
  renderCard({
    ...FETCH_REQUEST,
    toolName: "capture_memory",
    fields: [{ key: "content", value: note, block: true }],
  });

  expect(screen.queryByText(note)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: SHOW_FULL_REQUEST }));
  expect(screen.getByText(note)).toBeDefined();
});

const FOLLOWUP_REQUEST: AssistantInputRequestView = {
  ...FETCH_REQUEST,
  toolName: "accept_suggested_followup",
  fields: [{ key: "followupId", value: "fu_123", block: false }],
  input: { followupId: "fu_123" },
};

/**
 * The point of the whole lookup. `accept_suggested_followup` freezes a UUID and
 * nothing else, and a UUID is not something a person can consent to — so the record
 * it names leads the card, and the id it was named by is still one click away.
 */
it("leads with the record the server described, keeping the frozen input reachable", async () => {
  describeSubject.mockResolvedValue(
    described("Accept a follow-up with Mara", ["Reason: check in about the move"]),
  );
  renderCard(FOLLOWUP_REQUEST);

  await waitFor(() => expect(screen.getByText("Accept a follow-up with Mara")).toBeDefined());
  expect(screen.getByText("Reason: check in about the move")).toBeDefined();
  expect(screen.queryByText("The assistant wants to run accept suggested followup.")).toBeNull();

  // A summary is an aid to the decision, never a replacement for it: what actually
  // executes is the input, so it stays one deliberate click away.
  expect(screen.queryByText("fu_123")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: SHOW_FULL_REQUEST }));
  expect(screen.getByText("followupId")).toBeDefined();
  expect(screen.getByText("fu_123")).toBeDefined();
});

it("puts the decision on the disclosure's row rather than a row of its own", async () => {
  describeSubject.mockResolvedValue(described("Accept a follow-up with Mara"));
  renderCard(FOLLOWUP_REQUEST);

  await waitFor(() => expect(screen.getByText("Accept a follow-up with Mara")).toBeDefined());
  const decision = document.querySelector("[data-slot=approval-decision]");
  expect(decision).not.toBeNull();
  expect(decision?.contains(screen.getByRole("button", { name: SHOW_FULL_REQUEST }))).toBe(true);
  expect(decision?.contains(screen.getByRole("button", { name: "Approve" }))).toBe(true);
  expect(decision?.contains(screen.getByRole("button", { name: "Cancel" }))).toBe(true);
});

it("asks about the call with the tool name and the input the card itself displays", async () => {
  describeSubject.mockResolvedValue(described("Accept a follow-up with Mara"));
  renderCard(FOLLOWUP_REQUEST);

  await waitFor(() =>
    expect(describeSubject).toHaveBeenCalledWith({
      toolName: "accept_suggested_followup",
      input: { followupId: "fu_123" },
    }),
  );
});

/**
 * A tool with no describer is not a refusal — it is the ordinary case for a call
 * whose input already reads as English. The card must say nothing extra and keep the
 * arguments in plain sight.
 */
it("falls back to the generic heading when no describer is registered", async () => {
  describeSubject.mockResolvedValue({ ok: true, view: { kind: "unknown-tool" } });
  renderCard(FETCH_REQUEST);

  await waitFor(() => expect(describeSubject).toHaveBeenCalled());
  expect(screen.getByText("The assistant wants to run web fetch.")).toBeDefined();
  expect(screen.getByText("https://example.com/articles/tea-ceremony")).toBeDefined();
  expect(screen.queryByText(/isn't available to you/)).toBeNull();
});

/**
 * `missing` covers "no such record", "not yours", and "that input did not parse"
 * without distinguishing them (ADR 0219). The agent-side policy already denied a
 * foreign record long before a card existed, so this is belt and braces — and the
 * decision stays open, because refusing on the client would be inventing a verdict.
 */
it("says so plainly, and stays answerable, when the record does not resolve", async () => {
  describeSubject.mockResolvedValue({ ok: true, view: { kind: "missing" } });
  renderCard(FOLLOWUP_REQUEST);

  await waitFor(() =>
    expect(screen.getByText("This record isn't available to you.")).toBeDefined(),
  );
  expect(screen.getByText("The assistant wants to run accept suggested followup.")).toBeDefined();
  expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  expect(screen.getByText("fu_123")).toBeDefined();
});

/**
 * A refused request tells the owner nothing about the record either, so it lands in
 * the same neutral place rather than leaking a validation message into the decision.
 */
it("treats a refused lookup the same as a record that does not resolve", async () => {
  describeSubject.mockResolvedValue({ ok: false, error: "Too small: expected string" });
  renderCard(FOLLOWUP_REQUEST);

  await waitFor(() =>
    expect(screen.getByText("This record isn't available to you.")).toBeDefined(),
  );
  expect(screen.queryByText(/Too small/)).toBeNull();
});

/**
 * A dropped connection says nothing about the record, so the card must not claim it
 * is unavailable. It degrades to exactly what it showed before any lookup existed.
 */
it("makes no claim about the record when the lookup itself fails", async () => {
  describeSubject.mockRejectedValue(new Error("offline"));
  renderCard(FOLLOWUP_REQUEST);

  await waitFor(() => expect(describeSubject).toHaveBeenCalled());
  expect(screen.getByText("The assistant wants to run accept suggested followup.")).toBeDefined();
  expect(screen.queryByText(/isn't available to you/)).toBeNull();
  expect(screen.getByText("fu_123")).toBeDefined();
});

/**
 * The lookup is an owner-scoped database read, and the transcript re-renders on every
 * streamed token. Once per parked call, never once per render — and the guarantee has
 * to survive the card being unmounted and mounted again, because the panel does that.
 */
it("reads the owner's records once per parked call, however often the card renders", async () => {
  describeSubject.mockResolvedValue(described("Accept a follow-up with Mara"));
  const respond = vi.fn(async () => {});
  const card = (
    <AssistantRespondProvider ready respond={respond}>
      {/* A fresh `input` object each render: identity must not be what gates the read. */}
      <ChatApprovalCard request={{ ...FOLLOWUP_REQUEST, input: { followupId: "fu_123" } }} />
    </AssistantRespondProvider>
  );
  const view = render(card);

  await waitFor(() => expect(screen.getByText("Accept a follow-up with Mara")).toBeDefined());
  view.rerender(card);
  view.rerender(card);
  view.unmount();
  render(card);

  await waitFor(() => expect(screen.getByText("Accept a follow-up with Mara")).toBeDefined());
  expect(describeSubject).toHaveBeenCalledTimes(1);
});

it("never asks about a question, which names no record", async () => {
  renderCard({ ...FETCH_REQUEST, kind: "question", prompt: "Which Mara?", fields: [] });

  await waitFor(() => expect(screen.getByText("Which Mara?")).toBeDefined());
  expect(describeSubject).not.toHaveBeenCalled();
});

it("answers with the request id and the id of the option that was clicked", async () => {
  const respond = renderCard(FETCH_REQUEST);

  await userEvent.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith([{ requestId: "req-1", optionId: "approve" }]),
  );
});

it("sends the refusing option's own id, never a hardcoded one", async () => {
  const respond = renderCard({
    ...FETCH_REQUEST,
    // eve calls it `cancel`, not `decline`: a card that posted a guessed id would
    // leave the turn parked forever.
    options: [{ id: "cancel", label: "Cancel", description: null, style: "default" }],
  });

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith([{ requestId: "req-1", optionId: "cancel" }]),
  );
});

it("locks both options while an answer is on the wire, so a decision is sent once", async () => {
  // A response that never settles: the window in which a second click would post a
  // second answer to the same parked call.
  const respond = vi.fn(() => new Promise<void>(() => {}));
  renderCard(FETCH_REQUEST, { respond });

  await userEvent.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() =>
    expect((screen.getByRole("button", { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(respond).toHaveBeenCalledTimes(1);
});

/**
 * The one thing the resting card no longer says. A spinner sits inside a button the
 * owner has already looked away from, so the round trip gets an announced line for
 * exactly as long as it lasts.
 */
it("announces the round trip while an answer is on the wire, and only then", async () => {
  const respond = vi.fn(() => new Promise<void>(() => {}));
  renderCard(FETCH_REQUEST, { respond });

  expect(screen.queryByRole("status")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Sending your decision…"),
  );
});

it("disables the decision while eve is busy with another turn", () => {
  renderCard(FETCH_REQUEST, { ready: false });

  expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("says so, and stays answerable, when the response does not go through", async () => {
  const respond = vi.fn(async () => {
    throw new Error("stream closed");
  });
  renderCard(FETCH_REQUEST, { respond });

  await userEvent.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("didn't go through"));
  expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

/** `ask_question` rides the same channel, so the card has to render one too. */
it("renders a question's choices, and takes a typed answer only when eve allows one", async () => {
  const respond = renderCard({
    requestId: "req-2",
    toolCallId: "call-2",
    toolName: "ask_question",
    kind: "question",
    prompt: "Which Mara did you mean?",
    display: "select",
    allowFreeform: true,
    options: [
      { id: "ellis", label: "Mara Ellis", description: null, style: "default" },
      { id: "okonkwo", label: "Mara Okonkwo", description: null, style: "default" },
    ],
    fields: [],
    input: { question: "Which Mara did you mean?" },
  });

  expect(screen.getByText("A question for you")).toBeDefined();
  await userEvent.type(screen.getByLabelText("Your answer"), "Neither, a third one");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith([{ requestId: "req-2", text: "Neither, a third one" }]),
  );
});

it("offers no typed answer when the request does not accept one", () => {
  renderCard({ ...FETCH_REQUEST, allowFreeform: false });

  expect(screen.queryByLabelText("Your answer")).toBeNull();
});

const RESOLUTION: AssistantInputResolutionView = {
  toolCallId: "call-1",
  requestId: "req-1",
  toolName: "web_fetch",
  kind: "tool-approval",
  prompt: "Approve tool call: web_fetch",
  outcome: "approved",
  fields: [{ key: "url", value: "https://example.com/articles/tea-ceremony", block: false }],
  answerLabel: null,
  detail: null,
};

it.each([
  ["approved", "Approved"],
  ["declined", "Declined"],
  ["failed", "Failed"],
] as const)("settles in place as a quiet %s status", (outcome, word) => {
  render(<ChatApprovalStatus resolution={{ ...RESOLUTION, outcome }} />);

  expect(screen.getByText(word)).toBeDefined();
  // The decision stays legible after the fact - the tool and the argument the owner
  // looked at - so the transcript has no unexplained gap where a card used to be.
  expect(screen.getByText(/web fetch/).textContent).toContain(
    "https://example.com/articles/tea-ceremony",
  );
  expect(screen.queryByRole("button")).toBeNull();
});

it("echoes the answer the owner picked while eve has not settled the call", () => {
  render(
    <ChatApprovalStatus
      resolution={{ ...RESOLUTION, outcome: "answered", answerLabel: "Cancel" }}
    />,
  );

  expect(screen.getByText(/web fetch/).textContent).toContain("Cancel");
});

/**
 * The settled line is the transcript's record of a decision, so it should name what
 * the owner actually read — the record, not the uuid that stood in for it. It reuses
 * what the card already resolved rather than spending a second read on history.
 */
it("names the described record in the settled line, once the card's lookup has landed", async () => {
  describeSubject.mockResolvedValue(described("Accept a follow-up with Mara"));
  const { unmount } = render(
    <AssistantRespondProvider ready respond={vi.fn(async () => {})}>
      <ChatApprovalCard request={FOLLOWUP_REQUEST} />
    </AssistantRespondProvider>,
  );
  await waitFor(() => expect(screen.getByText("Accept a follow-up with Mara")).toBeDefined());
  unmount();

  render(<ChatApprovalStatus resolution={{ ...RESOLUTION, toolCallId: "call-1" }} />);

  expect(screen.getByText("Approved").parentElement?.textContent).toContain(
    "Accept a follow-up with Mara",
  );
  expect(describeSubject).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// A batch, the taint explanation, and the Session Tool Trust offer
// ---------------------------------------------------------------------------

/**
 * One `input.requested` can park several calls at once. The card that shows them has
 * one job the single card does not: to stay readable while carrying three decisions.
 * So the chrome is shared and the *decisions* are not - and "Approve all" is offered
 * without a "Cancel all" beside it, at no more weight than anything else.
 */

const SAVE_REQUEST: AssistantInputRequestView = {
  ...FETCH_REQUEST,
  requestId: "req-2",
  toolCallId: "call-2",
  toolName: "capture_memory",
  prompt: "Approve tool call: capture_memory",
  fields: [{ key: "content", value: "Allergic to shellfish.", block: false }],
  input: { content: "Allergic to shellfish." },
};

const TAINT_LINE =
  "The assistant asked because web content was read in this conversation. Start a new conversation to resume automatic saves.";

const REMEMBER_LABEL =
  "Don't ask again for this in this conversation (reversible private saves only)";

type PolicyOptions = {
  approvalMode?: EveApprovalMode;
  ready?: boolean;
  recordSessionToolTrust?: RecordSessionToolTrust;
  respond?: (responses: readonly { requestId: string }[]) => Promise<void>;
  /** Call ids the conversation read web content before. */
  tainted?: readonly string[];
  /** Null stands for a panel with no live session, where no trust can be recorded. */
  sessionId?: string | null;
};

function renderWithPolicy(card: React.ReactElement, options: PolicyOptions = {}) {
  const {
    approvalMode = "ask",
    ready = true,
    recordSessionToolTrust = vi.fn(async () => {}),
    respond = vi.fn(async () => {}),
    sessionId = "session-1",
    tainted = [],
  } = options;

  render(
    <AssistantRespondProvider ready={ready} respond={respond}>
      <AssistantApprovalPolicyProvider
        approvalMode={approvalMode}
        isTaintedBefore={(toolCallId) => tainted.includes(toolCallId)}
      >
        <SessionToolTrustProvider
          recordSessionToolTrust={recordSessionToolTrust}
          sessionId={sessionId}
        >
          {card}
        </SessionToolTrustProvider>
      </AssistantApprovalPolicyProvider>
    </AssistantRespondProvider>,
  );

  return { recordSessionToolTrust, respond };
}

function renderBatch(options: PolicyOptions = {}) {
  return renderWithPolicy(
    <ChatApprovalBatchCard requests={[FETCH_REQUEST, SAVE_REQUEST]} />,
    options,
  );
}

it("lists every parked call on one card, each with its own subject and answers", () => {
  renderBatch();

  expect(document.querySelectorAll("[data-tool-view=input_request]")).toHaveLength(1);
  expect(screen.getByText("2 decisions are waiting for you.")).toBeDefined();
  expect(screen.getByText("The assistant wants to run web fetch.")).toBeDefined();
  expect(screen.getByText("The assistant wants to run capture memory.")).toBeDefined();
  expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2);
  // The state chip is the card's, said once, rather than repeated over every item.
  expect(screen.getAllByText("Needs your approval")).toHaveLength(1);
});

it("answers every remaining request in one respond when the owner approves them all", async () => {
  const { respond } = renderBatch();

  await userEvent.click(screen.getByRole("button", { name: /Approve all/ }));

  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith([
      { requestId: "req-1", optionId: "approve" },
      { requestId: "req-2", optionId: "approve" },
    ]),
  );
  expect(respond).toHaveBeenCalledTimes(1);
});

/** Refusing in bulk is not something a person needs to do quickly. */
it("offers no way to cancel the whole batch at once", () => {
  renderBatch();

  expect(screen.queryByRole("button", { name: /Cancel all/ })).toBeNull();
});

/**
 * The shortcut through a batch must not be the button the eye lands on. It carries
 * exactly the weight the per-item answers do, and eve marks none of them primary.
 */
it("gives Approve all no more weight than a single item's own answer", () => {
  renderBatch();

  const approveAll = screen.getByRole("button", { name: /Approve all/ });
  const approve = screen.getAllByRole("button", { name: "Approve" })[0];
  expect(approveAll.getAttribute("data-variant")).toBe(approve?.getAttribute("data-variant"));
  expect(approveAll.getAttribute("data-variant")).not.toBe("default");
});

it("answers only the item whose own Cancel was clicked", async () => {
  const { respond } = renderBatch();

  await userEvent.click(screen.getAllByRole("button", { name: "Cancel" })[1] as HTMLElement);

  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith([{ requestId: "req-2", optionId: "cancel" }]),
  );
});

/**
 * Once a single item is left there is nothing to approve *all* of, and its own
 * button is the whole decision.
 */
it("retires Approve all once one decision is left", async () => {
  renderBatch();

  await userEvent.click(screen.getAllByRole("button", { name: "Approve" })[0] as HTMLElement);

  await waitFor(() => expect(screen.queryByRole("button", { name: /Approve all/ })).toBeNull());
});

it("will not answer an item twice while the card waits for the stream to catch up", async () => {
  const { respond } = renderBatch();

  const approve = screen.getAllByRole("button", { name: "Approve" })[0] as HTMLButtonElement;
  await userEvent.click(approve);
  await waitFor(() => expect(approve.disabled).toBe(true));

  await userEvent.click(approve);
  expect(respond).toHaveBeenCalledTimes(1);
});

/**
 * An owner in `trusted` mode who is asked anyway is owed the reason. Both halves are
 * required: the mode, and web content read before this very call.
 */
it("explains the interruption when a trusted conversation has read the web", () => {
  renderWithPolicy(<ChatApprovalCard request={SAVE_REQUEST} />, {
    approvalMode: "trusted",
    tainted: ["call-2"],
  });

  expect(screen.getByText(TAINT_LINE)).toBeDefined();
});

it("says nothing about the web when nothing in the conversation read it", () => {
  renderWithPolicy(<ChatApprovalCard request={SAVE_REQUEST} />, { approvalMode: "trusted" });

  expect(screen.queryByText(TAINT_LINE)).toBeNull();
});

/** In `ask` mode every call was always going to pause; there is nothing to explain. */
it("says nothing about the web to an owner who asked to be asked", () => {
  renderWithPolicy(<ChatApprovalCard request={SAVE_REQUEST} />, {
    approvalMode: "ask",
    tainted: ["call-2"],
  });

  expect(screen.queryByText(TAINT_LINE)).toBeNull();
});

/** Explanatory only: the same click sends the same thing with the line on screen. */
it("changes nothing about the answer it sends", async () => {
  const { respond } = renderWithPolicy(<ChatApprovalCard request={SAVE_REQUEST} />, {
    approvalMode: "trusted",
    tainted: ["call-2"],
  });

  await userEvent.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith([{ requestId: "req-2", optionId: "approve" }]),
  );
});

it("offers to stop asking about this tool for the rest of the conversation", () => {
  renderWithPolicy(<ChatApprovalCard request={SAVE_REQUEST} />);

  const remember = screen.getByLabelText(REMEMBER_LABEL) as HTMLInputElement;
  // Unticked by default: a Session Tool Trust is a thing the owner reaches for.
  expect(remember.getAttribute("data-state")).toBe("unchecked");
});

/**
 * The agent ignores every Session Tool Trust in a Tainted Conversation, so offering
 * one there would be a control that quietly does nothing.
 */
it("withholds the offer once the conversation has read web content", () => {
  renderWithPolicy(<ChatApprovalCard request={SAVE_REQUEST} />, { tainted: ["call-2"] });

  expect(screen.queryByLabelText(REMEMBER_LABEL)).toBeNull();
});

it("withholds the offer on a question, which authorizes nothing", () => {
  renderWithPolicy(
    <ChatApprovalCard
      request={{ ...SAVE_REQUEST, kind: "question", prompt: "Which Mara?", fields: [] }}
    />,
  );

  expect(screen.queryByLabelText(REMEMBER_LABEL)).toBeNull();
});

/**
 * A Session Tool Trust is honoured only for a Reversible Private Write, so on a
 * fetch, a send, or a permanent deletion the box would be a control the agent
 * ignores. The tier itself comes from `@tendnote/domain/eve-approvals`, which
 * `apps/agent/tests/write-tool-approval.test.ts` holds to the tools' own gates.
 */
it("withholds the offer on an always-ask call such as a web fetch", () => {
  renderWithPolicy(<ChatApprovalCard request={FETCH_REQUEST} />);

  expect(screen.queryByLabelText(REMEMBER_LABEL)).toBeNull();
});

it("offers it on a capture whose audience is the owner alone", () => {
  renderWithPolicy(
    <ChatApprovalCard
      request={{
        ...SAVE_REQUEST,
        toolName: "capture_saved_item",
        input: { originalText: "Mara starts at the clinic in March." },
      }}
    />,
  );

  expect(screen.getByLabelText(REMEMBER_LABEL)).toBeDefined();
});

/**
 * The one tool whose tier depends on its arguments: a capture that names a
 * `requestedScope` is asking to widen its audience beyond the owner, and the
 * policy asks about it whatever the mode. The frozen input is what says so, which
 * is why the card reads it and not the tool name alone.
 */
it("withholds it on a capture that asks for a wider audience", () => {
  renderWithPolicy(
    <ChatApprovalCard
      request={{
        ...SAVE_REQUEST,
        toolName: "capture_saved_item",
        input: { originalText: "Book the campsite.", requestedScope: "household" },
      }}
    />,
  );

  expect(screen.queryByLabelText(REMEMBER_LABEL)).toBeNull();
});

it("records the trust only once the approval it rode on has gone through", async () => {
  const { recordSessionToolTrust } = renderWithPolicy(<ChatApprovalCard request={SAVE_REQUEST} />);

  await userEvent.click(screen.getByLabelText(REMEMBER_LABEL));
  expect(recordSessionToolTrust).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() =>
    expect(recordSessionToolTrust).toHaveBeenCalledWith({
      sessionId: "session-1",
      toolName: "capture_memory",
    }),
  );
});

/** Cancelling authorizes nothing, so there is nothing to remember. */
it("records nothing when the owner ticks the box and then cancels", async () => {
  const { recordSessionToolTrust } = renderWithPolicy(<ChatApprovalCard request={SAVE_REQUEST} />);

  await userEvent.click(screen.getByLabelText(REMEMBER_LABEL));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(recordSessionToolTrust).not.toHaveBeenCalled();
});

it("remembers each batch item on its own when the whole batch is approved", async () => {
  const { recordSessionToolTrust } = renderBatch();

  // One offer on this card, not two: the fetch is always-ask, so only the capture
  // has a trust to give.
  expect(screen.getAllByLabelText(REMEMBER_LABEL)).toHaveLength(1);
  await userEvent.click(screen.getByLabelText(REMEMBER_LABEL));
  await userEvent.click(screen.getByRole("button", { name: /Approve all/ }));

  await waitFor(() => expect(recordSessionToolTrust).toHaveBeenCalledTimes(1));
  expect(recordSessionToolTrust).toHaveBeenCalledWith({
    sessionId: "session-1",
    toolName: "capture_memory",
  });
});
