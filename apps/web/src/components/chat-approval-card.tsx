"use client";

import { Body, ResultCard } from "@/components/assistant-result-card";
import { ToolActivityLine } from "@/components/assistant-results/shells";
import {
  APPROVE_ALL_KEY,
  type ApprovalDecisions,
  useApprovalDecisions,
} from "@/components/chat-approval-decisions";
import {
  ApprovalRequestItem,
  ApprovalStateChip,
  truncateApprovalValue,
} from "@/components/chat-approval-item";
import { ApprovalTaintNote } from "@/components/chat-approval-taint-note";
import { CheckIcon, CircleSlashIcon, TriangleAlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useApprovalSubjectTitle } from "@/components/use-approval-subject";
import { approveOptionId } from "@/lib/eve/approval-answers";
import type {
  AssistantInputRequestView,
  AssistantInputResolutionView,
} from "@/lib/eve/input-request-view";
import { humanizeToolName } from "@/lib/eve/tool-name";
import { cn } from "@/lib/utils";

/**
 * The in-chat decision for a tool call Eve parked on the owner.
 *
 * Eve's approval policy holds the *specific* call - frozen input, frozen call id -
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
 *    either. The only account of what is about to happen is the parked call - its tool
 *    name and its arguments - so the card renders those, and never treats an approval's
 *    `prompt` as if it said something. Approving a description that is not the action
 *    is exactly the failure this whole gate exists to prevent.
 *
 *    A frozen input is often a UUID, though, and a UUID is not something a person can
 *    consent to. So the card also asks the server what that id *names*, inside the
 *    owner's own scope (`useApprovalSubject`), and leads with the answer. That is a
 *    second rendering of the same input, never a substitute for it: the literal
 *    payload stays one click away under "Show the full request", so a
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
 * unreadable while the owner decides - which is how a gate stops being read at all. So
 * every row here carries something: the state chip labels the heading on its own line,
 * and the decision shares the line the disclosure starts rather than taking one of its
 * own. The standing "nothing happens until you choose" footer is gone with it; the chip
 * says that, and two live buttons say it better. Only the round trip still gets words,
 * and only while it is in flight.
 *
 * That size rule is also why a batch of calls parked in one breath is one card
 * ({@link ChatApprovalBatchCard}) rather than five stacked surfaces. It shares the
 * chrome and nothing else: each item keeps its own subject, its own frozen input, and
 * its own two buttons, because each is a separate authorization.
 *
 * ## Where the rest of it lives
 *
 * This file is the chrome and the settled line. One parked call renders through
 * `chat-approval-item.tsx`, the answering state is `chat-approval-decisions.ts`,
 * and the two pieces of copy that exist because of Approval Modes have files of
 * their own: `chat-approval-trust-offer.tsx` and `chat-approval-taint-note.tsx`.
 */

export function ChatApprovalCard({
  request,
  isNew = false,
}: {
  request: AssistantInputRequestView;
  isNew?: boolean;
}) {
  const decisions = useApprovalDecisions();

  return (
    <ResultCard isNew={isNew} kind="input_request" tone="tentative">
      {/* One child, so this card sets its own rhythm rather than the shell's uniform
          gap: the state chip, the heading and the record it names are one thought and
          sit tight together, and only the decision is held apart from them. */}
      <div className="flex flex-col gap-2">
        <ApprovalRequestItem
          chip
          decisions={decisions}
          explanation={<ApprovalTaintNote requests={[request]} />}
          request={request}
        />
        <ApprovalDecisionStatus decisions={decisions} sending={approvalCopySending(request.kind)} />
      </div>
    </ResultCard>
  );
}

/**
 * One `input.requested` batch: several calls Eve parked in the same breath, on one
 * card.
 *
 * A card each would be right if they were separate decisions, but they are not -
 * they are one moment of the turn, and stacking five identical bordered surfaces
 * down the transcript is how a gate stops being read (see rule 4 above). So the
 * chrome is paid for once: one state chip, one round-trip line, one failure line,
 * and one hairline between items instead of a border around each.
 *
 * What is *not* shared is the decision. Every item keeps its own subject lookup, its
 * own frozen input, and its own Approve and Cancel, because each is a distinct
 * authorization and a card that answered them together by default would be exactly
 * the standing permission the gate exists to refuse. "Approve all" is offered, once,
 * at the same weight as everything else and with no "Cancel all" beside it: refusing
 * in bulk is not a thing a person needs to do quickly.
 */
export function ChatApprovalBatchCard({
  isNew = false,
  requests,
}: {
  isNew?: boolean;
  requests: readonly AssistantInputRequestView[];
}) {
  const decisions = useApprovalDecisions();

  // Every item still waiting that offers eve's own affirmative option. Nothing here
  // invents an id: a request without an `approve` option simply is not part of what
  // "Approve all" answers, and the control retires when fewer than two are left.
  const approveAll = requests.flatMap((request) => {
    const optionId = decisions.answered.has(request.toolCallId) ? null : approveOptionId(request);
    return optionId ? [{ request, response: { optionId } }] : [];
  });

  return (
    <ResultCard isNew={isNew} kind="input_request" tone="tentative">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-slot="approval-header">
          <ApprovalStateChip>Needs your approval</ApprovalStateChip>
          <Body>{`${requests.length} decisions are waiting for you.`}</Body>
        </div>

        <ApprovalTaintNote requests={requests} />

        {requests.map((request, index) => (
          // A hairline between items rather than a border around each: the card is
          // already a surface, and nested cards are the one thing the system rules
          // out outright (DESIGN.md §6).
          <div
            className={cn("flex flex-col gap-2", index > 0 && "border-accent/20 border-t pt-2.5")}
            key={request.toolCallId}
          >
            <ApprovalRequestItem decisions={decisions} request={request} />
          </div>
        ))}

        {approveAll.length > 1 ? (
          <div
            className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 border-accent/20 border-t pt-2.5"
            data-slot="approval-batch-decision"
          >
            <Button
              disabled={decisions.locked}
              onClick={() => void decisions.answer(APPROVE_ALL_KEY, approveAll)}
              size="sm"
              type="button"
              // Never `default`: the shortcut through a batch must not be the sage
              // button the eye lands on first.
              variant="outline"
            >
              {/* Decorative: the card's own status line announces the round trip. */}
              {decisions.sending === APPROVE_ALL_KEY ? <Spinner aria-hidden /> : null}
              Approve all
            </Button>
          </div>
        ) : null}

        <ApprovalDecisionStatus decisions={decisions} sending="Sending your decision…" />
      </div>
    </ResultCard>
  );
}

/**
 * The card's live state, in the two lines it is worth spending.
 *
 * The card's resting state says "nothing has happened yet" through the chip and
 * the two live buttons; only the round trip needs words, and only while it lasts.
 * Announced, because the visible sign of it is a spinner in a button the owner has
 * already stopped looking at.
 */
function ApprovalDecisionStatus({
  decisions,
  sending,
}: {
  decisions: ApprovalDecisions;
  /** What to call the answer on the wire; a question is answered, a call decided. */
  sending: string;
}) {
  return (
    <>
      {decisions.sending !== null ? (
        <p className="text-[length:var(--text-caption)] text-muted-foreground" role="status">
          {sending}
        </p>
      ) : null}

      {decisions.failure ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {decisions.failure}
        </p>
      ) : null}
    </>
  );
}

/** What the round trip is called. Neither "approval" nor "refusal": the owner may
 * have just pressed Cancel. */
function approvalCopySending(kind: AssistantInputRequestView["kind"]): string {
  return kind === "tool-approval" ? "Sending your decision…" : "Sending your answer…";
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
 * the line falls back to the tool plus its first argument - the URL, the person id -
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
  return first ? `${tool} · ${truncateApprovalValue(first.value.split("\n", 1)[0] ?? "")}` : tool;
}

/**
 * What became of a parked request, in the slot its card held.
 *
 * The card settles into a line rather than disappearing: a decision the owner made
 * mid-turn is part of the record of that turn, and a transcript that erased it would
 * leave an unexplained gap where an approval used to be. It stays a *line* because
 * the decision is over - the weight belonged to the moment of deciding.
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
