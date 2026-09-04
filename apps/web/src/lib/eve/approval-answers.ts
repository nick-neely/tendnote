import type { EveMessage } from "eve/react";
import { type AssistantInputRequestView, toInputRequestView } from "./input-request-view";

/**
 * Answering a parked approval by something other than clicking its own button.
 *
 * Two of those exist: the composer, where an owner who was told to "type approve"
 * by an older habit would otherwise send the word as a message and cancel the very
 * thing they meant to allow, and "Approve all", which settles a whole batch at once.
 * Both need the same two facts about a request — which option is the affirmative
 * one, and which requests are still waiting — so both live here rather than being
 * re-derived at each call site.
 *
 * The rule the approval card states holds here too: *the answer is the id eve asked
 * for*. Nothing in this module invents an option id. {@link APPROVE_OPTION_ID} is
 * eve's own affirmative id (`extractApprovalRequests` authors `approve` / `cancel`),
 * and every function that uses it looks it up in the request's own options and
 * yields nothing when it is absent — so a framework that renamed its options would
 * lose these shortcuts rather than start answering the wrong way.
 */

/**
 * eve's own id for the affirmative answer to a `tool-approval`. Never sent unless
 * the request itself offers an option with this id.
 */
export const APPROVE_OPTION_ID = "approve";

/** The words the composer treats as an answer rather than as a message. */
const TYPED_ANSWER_WORDS: readonly string[] = [APPROVE_OPTION_ID, "cancel"];

/**
 * Every tool-approval Eve has parked and the owner has not answered, oldest first.
 *
 * Transcript order is turn order, so the first entry is the oldest waiting decision
 * — which is the one a typed `approve` answers. Questions are excluded: they carry
 * the model's own words and their options are whatever it offered, so a word typed
 * into the composer is an answer to *them* only through eve's own matching, not
 * through this shortcut.
 */
export function pendingApprovalRequests(
  messages: readonly EveMessage[],
): AssistantInputRequestView[] {
  const pending: AssistantInputRequestView[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts) {
      const request = toInputRequestView(part);
      if (request?.kind === "tool-approval") {
        pending.push(request);
      }
    }
  }

  return pending;
}

/** The id of this request's affirmative option, when it offers one. */
export function approveOptionId(request: AssistantInputRequestView): string | null {
  return request.options.some((option) => option.id === APPROVE_OPTION_ID)
    ? APPROVE_OPTION_ID
    : null;
}

/**
 * The option a line typed in the composer answers with, or `null` to send it as an
 * ordinary message.
 *
 * Exact match only, trimmed and case-folded: "approve" and "Cancel" are answers,
 * "approve the fetch but not the save" is a sentence the owner meant Eve to read.
 * The word then has to *be* one of the ids the request offers — matching, never
 * mapping, so a typed answer and a clicked one send the same thing.
 */
export function typedApprovalAnswer(
  request: AssistantInputRequestView,
  text: string,
): string | null {
  const word = text.trim().toLowerCase();
  if (!TYPED_ANSWER_WORDS.includes(word)) {
    return null;
  }
  return request.options.find((option) => option.id.toLowerCase() === word)?.id ?? null;
}
