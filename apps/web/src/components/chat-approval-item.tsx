"use client";

import { useId, useState } from "react";
import { Body, Caption } from "@/components/assistant-result-card";
import type { ApprovalDecisions, ItemAnswerHandler } from "@/components/chat-approval-decisions";
import { FREEFORM_KEY } from "@/components/chat-approval-decisions";
import { ApprovalTrustCheckbox } from "@/components/chat-approval-trust-offer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useApprovalSubject } from "@/components/use-approval-subject";
import type { ApprovalSubjectState } from "@/lib/approval-subject-cache";
import type {
  AssistantInputField,
  AssistantInputOption,
  AssistantInputRequestView,
} from "@/lib/eve/input-request-view";
import { humanizeToolName } from "@/lib/eve/tool-name";

/**
 * One parked call, as the owner reads and answers it.
 *
 * Everything on this side of the split is about a single decision: what the call
 * is about, the arguments it is frozen with, the trust that may ride along, and
 * the buttons. The card modules own the chrome around it - one card or a batch -
 * and neither knows what an item is made of.
 */

/** How many input rows show before the card offers to expand. */
const PREVIEW_FIELDS = 3;

/** The one thing the card says when the owner-scoped lookup found no record. */
const NO_SUCH_RECORD = "This record isn't available to you.";

/** The collapsed length of one long value: enough to recognize, short enough to skim. */
const PREVIEW_VALUE_LENGTH = 160;

export function truncateApprovalValue(value: string): string {
  return value.length > PREVIEW_VALUE_LENGTH ? `${value.slice(0, PREVIEW_VALUE_LENGTH)}…` : value;
}

/** The card's state chip: what is being asked of the owner, before anything else. */
export function ApprovalStateChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {children}
    </span>
  );
}

/**
 * One parked call on a card: what it is, what it is frozen with, and the two answers
 * to it.
 *
 * A fragment rather than a wrapper, so the single card's own `gap-2` column still
 * spaces the header, the input, and the decision exactly as it did before batching
 * existed, and the batch card can put its own container (and hairline) around it.
 *
 * `chip` belongs to the card, not the item: on a single card the state chip labels
 * the one heading there is, and on a batch the card's header already carries it once
 * for all of them.
 */
export function ApprovalRequestItem({
  chip = false,
  decisions,
  explanation = null,
  request,
}: {
  chip?: boolean;
  decisions: ApprovalDecisions;
  /**
   * Why this card is asking, when that is not obvious. It rides with the heading
   * rather than sitting at the foot: a reason that arrives after the buttons is a
   * reason the owner reads once they have already decided. A batch says it once for
   * all of its items and passes nothing here.
   */
  explanation?: React.ReactNode;
  request: AssistantInputRequestView;
}) {
  /**
   * What this call is *about*, resolved server-side inside the owner's own scope.
   * An id-referenced write shows a bare UUID otherwise, and a UUID is not something
   * a person can consent to. The frozen input stays reachable either way: a summary
   * is an aid to the decision, never a replacement for it.
   */
  const subject = useApprovalSubject(request);
  /**
   * Whether the frozen input is unfolded. It lives here rather than beside the list
   * because its control does not: the disclosure shares the decision row with the
   * buttons, which is what keeps that row from being a band of empty space.
   */
  const [showInput, setShowInput] = useState(false);
  const describedById = useId();

  const isApproval = request.kind === "tool-approval";
  const copy = approvalCopy(request, subject);
  const input = visibleApprovalFields(request.fields, subject.status === "described", showInput);
  // An answer already sent from this card retires its own controls, so a batch item
  // cannot be answered twice in the moment before the stream replaces it.
  const locked = decisions.locked || decisions.answered.has(request.toolCallId);

  const control = (name: string) => `${request.toolCallId}:${name}`;
  const onAnswer: ItemAnswerHandler = (name, response) =>
    decisions.answer(control(name), [{ request, response }]);

  return (
    <>
      <div className="flex flex-col gap-1">
        {/* The chip labels the heading, so it sits on the heading's line while both
            fit and drops above it when they do not - one structure, no breakpoint. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-slot="approval-header">
          {chip ? <ApprovalStateChip>{copy.chip}</ApprovalStateChip> : null}

          <Body className="whitespace-pre-line" id={describedById}>
            {copy.heading}
          </Body>
        </div>

        {isApproval ? <ApprovalSubjectDetail subject={subject} /> : null}
        {explanation}
      </div>

      {/* The arguments the call is frozen with. Once the record itself has a heading
          and detail lines, the ids and flags behind it are the second thing to read
          rather than the first - but they are never summarized away, because what
          executes is this input and not the sentence describing it. */}
      {input.shown.length > 0 ? (
        <ApprovalInputFields expanded={showInput} fields={input.shown} />
      ) : null}

      {/* Above the buttons, because it changes what Approve means and a keyboard
          reaching Approve first would pass it by. */}
      <ApprovalTrustCheckbox decisions={decisions} locked={locked} request={request} />

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
        isSending={(name) => decisions.sending === control(name)}
        locked={locked}
        onAnswer={onAnswer}
        request={request}
      />
    </>
  );
}

/**
 * Everything the card *says* about a request, decided in one place.
 *
 * The three lines are one judgement, not three: they all turn on whether this is a
 * tool call the owner is authorizing or a question the model asked, and reading them
 * side by side is the only way to see that the approval branch never quotes eve's
 * prompt. It cannot - for `tool-approval` the framework fixes that string to
 * "Approve tool call: <toolName>", so it names the tool and nothing else.
 *
 * A described record names itself instead - "Archive a memory about Ana" - which is
 * the sentence the owner is actually being asked to agree to. Until the lookup lands,
 * and whenever it has nothing to say, the tool name is the honest fallback.
 */
function approvalCopy(
  request: AssistantInputRequestView,
  subject: ApprovalSubjectState,
): { chip: string; heading: string } {
  if (request.kind !== "tool-approval") {
    return { chip: "A question for you", heading: request.prompt };
  }

  return {
    chip: "Needs your approval",
    heading:
      subject.status === "described"
        ? subject.subject.title
        : `The assistant wants to run ${humanizeToolName(request.toolName)}.`,
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
 * Options and freeform are independent - a question can carry both - so neither is
 * assumed. When eve offers neither, the turn is still resolvable by typing in the
 * composer (the framework matches a typed follow-up against the option ids), and
 * saying so is better than a card with no way out of it.
 */
function ApprovalAnswerControls({
  describedById,
  disclosure,
  isSending,
  locked,
  onAnswer,
  request,
}: {
  describedById: string;
  /** The frozen input's show/hide control, when there is anything folded away. */
  disclosure: React.ReactNode;
  /** Whether this item's named control is the one whose answer is on the wire. */
  isSending: (control: string) => boolean;
  locked: boolean;
  onAnswer: ItemAnswerHandler;
  request: AssistantInputRequestView;
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
                  sending={isSending(option.id)}
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
          sending={isSending(FREEFORM_KEY)}
        />
      ) : null}
    </>
  );
}

/**
 * A typed answer, for the requests that accept one. The draft lives here because it
 * belongs to this control alone - nothing else in the card reads it, and it is not
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
  onAnswer: ItemAnswerHandler;
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
 * while it is out. That does not promise the exact height the answer will take -
 * nothing can, since a described record may carry one detail line or three - but it
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
    // to say plainly rather than a refusal. The decision stays open - the call may
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
 * Long or numerous arguments collapse to a preview rather than burying the buttons -
 * but only the *presentation* collapses: everything is one click away, and the cap is
 * generous enough that ordinary calls (a URL, a memory, a person id) never trip it. A
 * decision the owner has to scroll past is a decision they will stop reading.
 *
 * `secondary` is true when a described record already leads the card. The input then
 * starts folded - every argument, not just the overflow - so the owner reads the record
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
      {expanded ? "Show less" : "Show the full request"}
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
      {expanded || !field.block ? field.value : truncateApprovalValue(field.value)}
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

/**
 * One offered answer. The framework sends no style hint for an approval, and this does
 * not invent one - both choices render at the same weight, so the card asks rather than
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
