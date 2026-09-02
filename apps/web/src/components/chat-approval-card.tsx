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
 *
 * A fourth rule is about size, and it is not cosmetic. This card interrupts a
 * conversation, and a card that fills half the panel makes the transcript around it
 * unreadable while the owner decides — which is how a gate stops being read at all. So
 * every row here carries something: the state chip labels the heading on its own line,
 * and the decision shares the line the disclosure starts rather than taking one of its
 * own. The standing "nothing happens until you choose" footer is gone with it; the chip
 * says that, and two live buttons say it better. Only the round trip still gets words,
 * and only while it is in flight.
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
  /**
   * Whether the frozen input is unfolded. It lives here rather than beside the list
   * because its control does not: the disclosure shares the decision row with the
   * buttons, which is what keeps that row from being a band of empty space.
   */
  const [showInput, setShowInput] = useState(false);
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

  const input = visibleApprovalFields(request.fields, subject.status === "described", showInput);

  return (
    <ResultCard isNew={isNew} kind="input_request" tone="tentative">
      {/* One child, so this card sets its own rhythm rather than the shell's uniform
          gap: the state chip, the heading and the record it names are one thought and
          sit tight together, and only the decision is held apart from them. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          {/* The chip labels the heading, so it sits on the heading's line while both
              fit and drops above it when they do not — one structure, no breakpoint. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-slot="approval-header">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              {copy.chip}
            </span>

            <Body className="whitespace-pre-line" id={describedById}>
              {copy.heading}
            </Body>
          </div>

          {isApproval ? <ApprovalSubjectDetail subject={subject} /> : null}
        </div>

        {/* The arguments the call is frozen with. Once the record itself has a heading
            and detail lines, the ids and flags behind it are the second thing to read
            rather than the first — but they are never summarized away, because what
            executes is this input and not the sentence describing it. */}
        {input.shown.length > 0 ? (
          <ApprovalInputFields expanded={showInput} fields={input.shown} />
        ) : null}

        <ApprovalAnswerControls
          describedById={describedById}
          disclosure={
            input.collapsible ? (
              <ApprovalInputToggle
                expanded={showInput}
                onToggle={() => setShowInput((open) => !open)}
              />
            ) : null
          }
          locked={locked}
          onAnswer={answer}
          request={request}
          sending={sending}
        />

        {/* The card's resting state says "nothing has happened yet" through the chip and
            the two live buttons; only the round trip needs words, and only while it
            lasts. Announced, because the visible sign of it is a spinner in a button
            the owner has already stopped looking at. */}
        {sending !== null ? (
          <p className="text-[length:var(--text-caption)] text-muted-foreground" role="status">
            {copy.sending}
          </p>
        ) : null}

        {failure ? (
          <p className="text-[length:var(--text-small)] text-destructive" role="alert">
            {failure}
          </p>
        ) : null}
      </div>
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
): { chip: string; heading: string; sending: string } {
  if (request.kind !== "tool-approval") {
    return {
      chip: "A question for you",
      heading: request.prompt,
      sending: "Sending your answer…",
    };
  }

  return {
    chip: "Needs your approval",
    heading:
      subject.status === "described"
        ? subject.subject.title
        : `The assistant wants to run ${humanizeToolName(request.toolName)}.`,
    // Neither "approval" nor "refusal": the owner may have just pressed Cancel.
    sending: "Sending your decision…",
  };
}

/**
 * The decision row: the ways this request can be answered, exactly as eve offered
 * them, sharing a line with whatever else the card has to say for itself.
 *
 * The buttons used to own a row of their own, which left most of it empty and made a
 * short card tall. They sit instead at the end of the line the disclosure starts, so
 * the row carries the last thing to read and the thing to do with it. `mr-auto` on the
 * disclosure rather than `justify-between` is what makes the wrap graceful: below
 * roughly 360px the two stop fitting, the disclosure keeps the first line, and the
 * buttons take the second still right-aligned.
 *
 * Options and freeform are independent — a question can carry both — so neither is
 * assumed. When eve offers neither, the turn is still resolvable by typing in the
 * composer (the framework matches a typed follow-up against the option ids), and
 * saying so is better than a card with no way out of it.
 */
function ApprovalAnswerControls({
  describedById,
  disclosure,
  locked,
  onAnswer,
  request,
  sending,
}: {
  describedById: string;
  /** The frozen input's show/hide control, when there is anything folded away. */
  disclosure: React.ReactNode;
  locked: boolean;
  onAnswer: AnswerHandler;
  request: AssistantInputRequestView;
  /** The key of the control whose answer is on the wire, or null. */
  sending: string | null;
}) {
  const hasOptions = request.options.length > 0;
  const note =
    !hasOptions && !request.allowFreeform ? (
      <Caption>Answer in the message box below to continue.</Caption>
    ) : null;

  return (
    <>
      {disclosure || hasOptions || note ? (
        <div
          className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5"
          data-slot="approval-decision"
        >
          {disclosure ? <span className="mr-auto">{disclosure}</span> : null}
          {note}
          {hasOptions ? (
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
        {/* Decorative: the card's own status line is what announces the round trip, and
            a second live region saying "Loading" would only talk over it. */}
        {sending ? <Spinner aria-hidden /> : null}
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

  // A hairline, not a stripe: one thin rule is the ledger's own way of marking a
  // quotation (DESIGN.md §5), while anything thicker becomes the colored side bar the
  // system rejects outright.
  return (
    <div className="flex flex-col gap-0.5 border-accent/45 border-l pl-2.5">
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
 * Which arguments are on show, and whether anything is being held back.
 *
 * Long or numerous arguments collapse to a preview rather than burying the buttons —
 * but only the *presentation* collapses: everything is one click away, and the cap is
 * generous enough that ordinary calls (a URL, a memory, a person id) never trip it. A
 * decision the owner has to scroll past is a decision they will stop reading.
 *
 * `secondary` is true when a described record already leads the card. The input then
 * starts folded — every argument, not just the overflow — so the owner reads the record
 * first and the ids second. One click still reaches the literal payload, and the
 * disclosure is always offered in this mode so there is never a card whose input cannot
 * be opened.
 */
function visibleApprovalFields(
  fields: readonly AssistantInputField[],
  secondary: boolean,
  expanded: boolean,
): { collapsible: boolean; shown: readonly AssistantInputField[] } {
  if (fields.length === 0) {
    return { collapsible: false, shown: [] };
  }

  return {
    collapsible: secondary || fields.length > PREVIEW_FIELDS || fields.some((f) => f.block),
    shown: expanded ? fields : secondary ? [] : fields.slice(0, PREVIEW_FIELDS),
  };
}

function ApprovalInputToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      aria-expanded={expanded}
      className="text-[length:var(--text-caption)] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      onClick={onToggle}
      type="button"
    >
      {expanded ? "Show less" : "Show everything that will be sent"}
    </button>
  );
}

/**
 * The parked call's arguments, as a labelled list.
 *
 * Flat, with no well around it: the card is already a bordered surface, and a second
 * box inside it bought nothing but two rows of padding on the one card that most needs
 * to be short. The mono values and muted keys separate the payload from the prose above
 * it well enough on their own.
 */
function ApprovalInputFields({
  expanded,
  fields,
}: {
  expanded: boolean;
  fields: readonly AssistantInputField[];
}) {
  return (
    <dl className="flex flex-col gap-1.5">
      {fields.map((field) => (
        <ApprovalInputRow expanded={expanded} field={field} key={field.key ?? field.value} />
      ))}
    </dl>
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

  // A scalar reads as one fact, so its name sits on the same line as it and the pair
  // costs one row instead of two. A block value needs the full width for its own
  // wrapping, so there the name keeps a line of its own above it.
  return (
    <div
      className={
        field.block
          ? "flex flex-col gap-0.5"
          : "flex flex-wrap items-baseline gap-x-2 leading-[var(--text-small-line)]"
      }
    >
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
      {/* Decorative, for the reason given on the freeform Send button. */}
      {sending ? <Spinner aria-hidden /> : null}
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
