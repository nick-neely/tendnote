/**
 * The bridge from a gated tool to the shared approval-subject registry.
 *
 * Every id-referenced durable write asks
 * `@tendnote/db/queries/approval-subjects`, so the record's identity, the
 * owner-scoped read that resolves it, and the words the web approval card
 * renders live in one place rather than once per tool — and the web surface can
 * describe a parked call without reimplementing the agent's half. A tool with
 * nothing to load (`web_fetch`) inlines its own resolver instead.
 */

import { describeApprovalSubject } from "@tendnote/db/queries/approval-subjects";
import type { ApprovalSubjectResolver } from "./subject";

/**
 * Resolves this call's subject through the shared registry.
 *
 * The three answers map onto the policy's two:
 *
 * - `described` → found. The registry's own words reach the approver through the
 *   web card, which asks it directly; this side only needed the verdict.
 * - `missing` → **not** found, which the policy turns into the uniform opaque
 *   denial. It covers "no such record", "not this owner's", and "that input did
 *   not parse" alike, so a foreign id never parks a turn (ADR 0219).
 * - `unknown-tool` → found. No describer is registered, which is not a refusal:
 *   the call still parks and the approver judges the raw input.
 */
export function describeRegisteredSubject<
  TInput = Record<string, unknown>,
>(): ApprovalSubjectResolver<TInput> {
  return async (input, ctx) => {
    const lookup = await describeApprovalSubject({
      ownerUserId: ctx.ownerUserId,
      toolName: ctx.toolName,
      input,
    });
    return { found: lookup.kind !== "missing" };
  };
}
