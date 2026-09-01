"use client";

import { useId, useState } from "react";
import { useAssistantRespond } from "@/components/assistant-respond-context";
import { Body, Caption, ResultCard } from "@/components/assistant-result-card";
import { ToolActivityLine } from "@/components/assistant-results/shells";
import { CheckIcon, CircleSlashIcon, TriangleAlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useApprovalSubject, useApprovalSubjectTitle } from "@/components/use-approval-subject";
import type { ApprovalSubjectState } from "@/lib/approval-subject-cache";
import type {
  AssistantInputField,
  AssistantInputOption,
  AssistantInputRequestView,
  AssistantInputResolutionView,
} from "@/lib/eve/input-request-view";
import { humanizeToolName } from "@/lib/eve/tool-name";

/**
 * The in-chat decision for a tool call Eve parked on the owner.
 *
 * Eve's approval policy holds the *specific* call — frozen input, frozen call id —
 * until the authenticated owner answers, and the answer never passes through the
 * model. So this card is the one place in the conversation where a click is the
 * authorization itself, not a review of something already written (contrast
 * `ChatReviewActionCard`, which resolves independent domain state through an ordinary
 * owner-scoped server action).
 *
 * Three rules follow from that, and all three are load-bearing:
 *
 * 1. **The frozen input is the description.** eve 0.47.7 authors the approval request
 *    itself, with the fixed prompt "Approve tool call: <toolName>" and no channel for a
 *    policy to explain anything; the request the browser receives carries no input
 *    either. The only account of what is about to happen is the parked call — its tool
 *    name and its arguments — so the card renders those, and never treats an approval's
 *    `prompt` as if it said something. Approving a description that is not the action
 *    is exactly the failure this whole gate exists to prevent.
 *
 *    A frozen input is often a UUID, though, and a UUID is not something a person can
 *    consent to. So the card also asks the server what that id *names*, inside the
 *    owner's own scope (`useApprovalSubject`), and leads with the answer. That is a
 *    second rendering of the same input, never a substitute for it: the literal
 *    payload stays one click away under "Show everything Eve will send", so a
 *    description that drifted from the call can always be caught.
 * 2. **The answer is the id Eve asked for.** Option ids and labels ride on the request
 *    (today `approve` / `cancel`); nothing here hardcodes one. A card that guessed an id
 *    would either fail to resolve the turn or resolve it the wrong way.
 * 3. **Neither answer is nudged.** The framework sends no style hint, and the card does
 *    not invent one: both choices carry equal weight, so the interface is not quietly
 *    arguing for approval. A request that *does* mark an option `primary` is honored.
 *
 * `kind: "question"` requests arrive through the same channel (the framework's own
 * `ask_question`), and there the prompt is the model's real question, so it leads.
 */

/** Identity for the freeform answer in `sending`; no option id can collide with it. */
const FREEFORM_KEY = " freeform";

/** How many input rows show before the card offers to expand. */
const PREVIEW_FIELDS = 3;

/** The one thing the card says when the owner-scoped lookup found no record. */
const NO_SUCH_RECORD = "This record isn't available to you.";

/** How the card posts one answer back: the control's key, and eve's own payload. */
type AnswerHandler = (key: string, response: { optionId?: string; text?: string }) => Promise<void>;

export function ChatApprovalCard({
  request,
  isNew = false,
}: {
  request: AssistantInputRequestView;
  isNew?: boolean;
}) {
  const { ready, respond } = useAssistantRespond();
  /**
   * What this call is *about*, resolved server-side inside the owner's own scope.
   * An id-referenced write shows a bare UUID otherwise, and a UUID is not something
   * a person can consent to. The frozen input stays reachable either way: a summary
   * is an aid to the decision, never a replacement for it.
   */
  const subject = useApprovalSubject(request);
  /** The answer currently on the wire, identified so its own control shows the wait. */
  const [sending, setSending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const describedById = useId();

  // Answering takes the whole session — eve refuses a response while any turn is in
  // flight — so a second pending card in the transcript is disabled by `ready` until
  // this one settles, rather than racing it into an error.
  const locked = sending !== null || !ready;
  const isApproval = request.kind === "tool-approval";
  const copy = approvalCopy(request, subject);

  async function answer(
    key: string,
    response: { optionId?: string; text?: string },
  ): Promise<void> {
    setSending(key);
    setFailure(null);
    try {
      await respond([{ requestId: request.requestId, ...response }]);
    } catch {
      setFailure("That didn't go through. Try again, or answer in the message box below.");
    } finally {
      setSending(null);
    }
  }

  return (
    <ResultCard
      footer={<Caption>{copy.waiting}</Caption>}
      isNew={isNew}
      kind="input_request"
      tone="tentative"
    >
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
        {copy.chip}
      </span>

      <Body className="whitespace-pre-line" id={describedById}>
        {copy.heading}
      </Body>

      {isApproval ? <ApprovalSubjectDetail subject={subject} /> : null}

      {/* The arguments the call is frozen with. Once the record itself has a heading
          and detail lines, the ids and flags behind it are the second thing to read
          rather than the first — but they are never summarized away, because what
          executes is this input and not the sentence describing it. */}
      {request.fields.length > 0 ? (
        <ApprovalInputFields fields={request.fields} secondary={subject.status === "described"} />
      ) : null}

      <ApprovalAnswerControls
        describedById={describedById}
        locked={locked}
        onAnswer={answer}
        request={request}
        sending={sending}
      />

      {failure ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {failure}
        </p>
      ) : null}
    </ResultCard>
  );
}

/**
 * Everything the card *says* about a request, decided in one place.
 *
 * The three lines are one judgement, not three: they all turn on whether this is a
 * tool call the owner is authorizing or a question the model asked, and reading them
 * side by side is the only way to see that the approval branch never quotes eve's
 * prompt. It cannot — for `tool-approval` the framework fixes that string to
 * "Approve tool call: <toolName>", so it names the tool and nothing else.
 *
 * A described record names itself instead — "Archive a memory about Ana" — which is
 * the sentence the owner is actually being asked to agree to. Until the lookup lands,
 * and whenever it has nothing to say, the tool name is the honest fallback.
 */
function approvalCopy(
  request: AssistantInputRequestView,
  subject: ApprovalSubjectState,
): { chip: string; heading: string; waiting: string } {
  if (request.kind !== "tool-approval") {
    return {
      chip: "Eve has a question",
      heading: request.prompt,
      waiting: "Eve is waiting for your answer.",
    };
  }

  return {
    chip: "Needs your approval",
    heading:
      subject.status === "described"
        ? subject.subject.title
        : `Eve wants to run ${humanizeToolName(request.toolName)}.`,
    waiting: "Nothing happens until you choose. Eve is waiting.",
  };
}

/**
 * The ways this request can be answered, exactly as eve offered them.
 *
 * Options and freeform are independent — a question can carry both — so neither is
 * assumed. When eve offers neither, the turn is still resolvable by typing in the
 * composer (the framework matches a typed follow-up against the option ids), and
 * saying so is better than a card with no way out of it.
 */
function ApprovalAnswerControls({
  describedById,
  locked,
  onAnswer,
  request,
  sending,
}: {
  describedById: string;
  locked: boolean;
  onAnswer: AnswerHandler;
  request: AssistantInputRequestView;
  /** The key of the control whose answer is on the wire, or null. */
  sending: string | null;
}) {
  if (request.options.length === 0 && !request.allowFreeform) {
    return <Caption>Answer in the message box below to continue.</Caption>;
  }

  return (
    <>
      {request.options.length > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {request.options.map((option) => (
            <OptionButton
              describedById={describedById}
              disabled={locked}
              key={option.id}
              onChoose={() => void onAnswer(option.id, { optionId: option.id })}
              option={option}
              sending={sending === option.id}
            />
          ))}
        </div>
      ) : null}

      {request.allowFreeform ? (
        <ApprovalFreeformField
          describedById={describedById}
          locked={locked}
          onAnswer={onAnswer}
          sending={sending === FREEFORM_KEY}
        />
      ) : null}
    </>
  );
}

/**
 * A typed answer, for the requests that accept one. The draft lives here because it
 * belongs to this control alone — nothing else in the card reads it, and it is not
 * part of the decision until Send.
 */
function ApprovalFreeformField({
  describedById,
  locked,
  onAnswer,
  sending,
}: {
  describedById: string;
  locked: boolean;
  onAnswer: AnswerHandler;
  sending: boolean;
}) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed.length > 0) {
          void onAnswer(FREEFORM_KEY, { text: trimmed });
        }
      }}
    >
      <Input
        aria-describedby={describedById}
        aria-label="Your answer"
        disabled={locked}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Type your answer…"
        value={draft}
      />
      <Button disabled={locked || trimmed.length === 0} size="sm" type="submit">
        {sending ? <Spinner /> : null}
        Send
      </Button>
    </form>
  );
}

/**
 * What the call is about, under the heading.
 *
 * The lookup is a server round-trip, so the slot holds one line's worth of space
 * while it is out. That does not promise the exact height the answer will take —
 * nothing can, since a described record may carry one detail line or three — but it
 * keeps the buttons from stepping out from under a cursor already on the way to
 * them, which is the failure that actually costs a wrong click.
 */
function ApprovalSubjectDetail({ subject }: { subject: ApprovalSubjectState }) {
  if (subject.status === "undescribed") {
    return null;
  }

  if (subject.status === "missing") {
    // Belt and braces: the agent-side policy denies a record outside the owner's
    // scope before any card exists, so this is a state the transcript should be able
    // to say plainly rather than a refusal. The decision stays open — the call may
    // well be one the owner still wants to allow.
    return (
      <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        {NO_SUCH_RECORD}
      </p>
    );
  }

  if (subject.status === "pending") {
    return (
      <div
        aria-hidden
        className="h-[var(--text-small-line)] w-1/2 animate-pulse rounded bg-accent/15"
      />
    );
  }

  if (subject.subject.lines.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5 border-accent/25 border-l-2 pl-2.5">
      {subject.subject.lines.map((line) => (
        <p
          className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
          key={line}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * The parked call's arguments, as a labelled list.
 *
 * Long or numerous arguments collapse to a preview rather than burying the buttons —
 * but only the *presentation* collapses: everything is one click away, and the cap is
 * generous enough that ordinary calls (a URL, a memory, a person id) never trip it. A
 * decision the owner has to scroll past is a decision they will stop reading.
 */
function ApprovalInputFields({
  fields,
  secondary,
}: {
  fields: readonly AssistantInputField[];
  /**
   * True when a described record already leads the card. The input then starts
   * folded — every argument, not just the overflow — so the owner reads the record
   * first and the ids second. One click still reaches the literal payload, and the
   * toggle is always offered in this mode so there is never a card whose input
   * cannot be opened.
   */
  secondary: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflowing =
    secondary || fields.length > PREVIEW_FIELDS || fields.some((field) => field.block);
  const shown = expanded ? fields : secondary ? [] : fields.slice(0, PREVIEW_FIELDS);
  const toggle = overflowing ? (
    <button
      aria-expanded={expanded}
      className="w-fit text-[length:var(--text-caption)] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      onClick={() => setExpanded((open) => !open)}
      type="button"
    >
      {expanded ? "Show less" : "Show everything Eve will send"}
    </button>
  ) : null;

  // Folded away entirely, the bordered well would be an empty box around nothing, so
  // the disclosure stands on its own until there is something to put in it.
  if (shown.length === 0) {
    return toggle;
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-accent/20 bg-background/60 p-2.5">
      <dl className="flex flex-col gap-1.5">
        {shown.map((field) => (
          <ApprovalInputRow expanded={expanded} field={field} key={field.key ?? field.value} />
        ))}
      </dl>
      {toggle}
    </div>
  );
}

function ApprovalInputRow({ expanded, field }: { expanded: boolean; field: AssistantInputField }) {
  // Mono for the value: an argument is a machine fact (DESIGN.md §4). At small rather
  // than caption size, because a URL or an id is what the owner has to read character
  // by character - this is the one line the whole decision rests on.
  const value = (
    <dd
      className={
        field.block
          ? "wrap-anywhere whitespace-pre-wrap font-mono text-[length:var(--text-small)] text-foreground leading-[var(--text-small-line)]"
          : "wrap-anywhere font-mono text-[length:var(--text-small)] text-foreground leading-[var(--text-small-line)]"
      }
    >
      {expanded || !field.block ? field.value : truncate(field.value)}
    </dd>
  );

  if (!field.key) {
    return value;
  }

  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-medium text-[length:var(--text-caption)] text-muted-foreground">
        {field.key}
      </dt>
      {value}
    </div>
  );
}

/** The collapsed length of one long value: enough to recognize, short enough to skim. */
const PREVIEW_VALUE_LENGTH = 160;

function truncate(value: string): string {
  return value.length > PREVIEW_VALUE_LENGTH ? `${value.slice(0, PREVIEW_VALUE_LENGTH)}…` : value;
}

/**
 * One offered answer. The framework sends no style hint for an approval, and this does
 * not invent one — both choices render at the same weight, so the card asks rather than
 * argues. A request that marks an option `primary` gets the emphasis it asked for.
 */
function OptionButton({
  describedById,
  disabled,
  onChoose,
  option,
  sending,
}: {
  describedById: string;
  disabled: boolean;
  onChoose: () => void;
  option: AssistantInputOption;
  sending: boolean;
}) {
  return (
    <Button
      aria-describedby={describedById}
      disabled={disabled}
      onClick={onChoose}
      size="sm"
      title={option.description ?? undefined}
      type="button"
      variant={
        option.style === "primary" ? "default" : option.style === "danger" ? "ghost" : "outline"
      }
    >
      {sending ? <Spinner /> : null}
      {option.label}
    </Button>
  );
}

const OUTCOME_COPY = {
  approved: { word: "Approved", tone: "text-primary" },
  answered: { word: "Answered", tone: "text-muted-foreground" },
  declined: { word: "Declined", tone: "text-muted-foreground" },
  failed: { word: "Failed", tone: "text-accent" },
} as const;

/**
 * The one-line reminder of which decision this was.
 *
 * If the card resolved the record, its title is what the owner read and decided on, so
 * that is what the line says. Otherwise an approval's prompt names only the tool, and
 * the line falls back to the tool plus its first argument — the URL, the person id —
 * which is then what they actually looked at. A question keeps its own words.
 */
function resolutionSummary(resolution: AssistantInputResolutionView, title: string | null): string {
  if (resolution.kind !== "tool-approval") {
    return resolution.prompt.split("\n", 1)[0]?.trim() ?? "";
  }
  if (title) {
    return title;
  }

  const tool = humanizeToolName(resolution.toolName);
  const first = resolution.fields[0];
  return first ? `${tool} · ${truncate(first.value.split("\n", 1)[0] ?? "")}` : tool;
}

/**
 * What became of a parked request, in the slot its card held.
 *
 * The card settles into a line rather than disappearing: a decision the owner made
 * mid-turn is part of the record of that turn, and a transcript that erased it would
 * leave an unexplained gap where an approval used to be. It stays a *line* because
 * the decision is over — the weight belonged to the moment of deciding.
 */
export function ChatApprovalStatus({
  resolution,
  isNew = false,
}: {
  resolution: AssistantInputResolutionView;
  isNew?: boolean;
}) {
  const { word, tone } = OUTCOME_COPY[resolution.outcome];
  // Whatever the card resolved while it was pending, reused rather than re-fetched:
  // the decision is over, and its history is not worth another owner-scoped read.
  const title = useApprovalSubjectTitle(resolution.toolCallId);
  const summary = resolutionSummary(resolution, title);
  const detail =
    resolution.outcome === "answered" ? resolution.answerLabel : (resolution.detail ?? null);

  return (
    <ToolActivityLine icon={<OutcomeIcon outcome={resolution.outcome} />} isNew={isNew}>
      {/* CSS-truncated, so the full account stays reachable on hover and in the
          accessibility tree rather than being lost at the ellipsis. */}
      <span className="block truncate" title={`${word}${summary ? ` · ${summary}` : ""}`}>
        <span className={tone}>{word}</span>
        {summary ? <> · {summary}</> : null}
        {detail ? <> — {detail}</> : null}
      </span>
    </ToolActivityLine>
  );
}

function OutcomeIcon({ outcome }: { outcome: AssistantInputResolutionView["outcome"] }) {
  if (outcome === "failed") {
    return <TriangleAlertIcon aria-hidden className="size-3.5 text-accent" />;
  }
  if (outcome === "declined") {
    return <CircleSlashIcon aria-hidden className="size-3.5" />;
  }
  return (
    <CheckIcon
      aria-hidden
      className={outcome === "approved" ? "size-3.5 text-primary" : "size-3.5"}
    />
  );
}
