/**
 * Claims that turn an internal draft edit into an approval, an external draft, or a send.
 *
 * This is deliberately structured by clause rather than one sentence-wide negative regex.
 * A negation or history phrase in one clause must not launder an affirmative claim after
 * "but"/"and" (for example, "I didn't send it, but it was sent").
 */

const CLAUSE_BREAK = /(?:[.!?]+|;|\s+[-–—]\s+|\b(?:and|but|however|though|although)\b)/gi;
const NEGATION =
  /\b(?:not|never|nothing|no|neither|nor|without|didn['’]?t|wasn['’]?t|weren['’]?t|isn['’]?t|aren['’]?t|haven['’]?t|hasn['’]?t|doesn['’]?t|don['’]?t|couldn['’]?t|wouldn['’]?t)\b/i;
const SEND_OR_READY = /\b(?:ready|send|sent|sending)\b/i;
const EXTERNALIZATION =
  /\b(?:an?\s+)?gmail\s+draft\b|\b(?:an?\s+)?external(?:ly)?(?:\s+\w+){0,2}\s+draft\b|\bexport(?:ed|s|ing)?\b|\bexternaliz(?:e|ed|es|ing)\b|\bon\s+its\s+way\b/i;
const APPROVAL = /\b(?:approve(?:d|s|ing)?|approval)\b/i;
const HISTORICAL_APPROVED_DRAFT =
  /\b(?:previously|formerly|once)\s+approved(?:\s+draft)?\b|\b(?:draft|message)\s+(?:was|had been|has been)\s+(?:previously|formerly|once)\s+approved\b|\b(?:draft|message)\s+(?:was|had been|has been)\s+approved\s+(?:previously|formerly|once)\b/i;
const HISTORICAL_APPROVAL = /\b(?:prior|previous|old|former|earlier)\s+approval\b/i;
const APPROVAL_EXPIRY = /\b(?:no longer|does not|doesn['’]?t|did not|didn['’]?t|not)\b/i;
const REAPPROVAL = /\bre-?approval\b/i;

function hasUnsafeApproval(clause: string) {
  if (!APPROVAL.test(clause)) return false;

  let remaining = clause;
  const historicalDraft = clause.match(HISTORICAL_APPROVED_DRAFT)?.[0];
  if (historicalDraft) {
    remaining = remaining.replace(historicalDraft, "");
  } else if (HISTORICAL_APPROVAL.test(clause) && APPROVAL_EXPIRY.test(clause)) {
    remaining = remaining.replace(HISTORICAL_APPROVAL, "");
  }

  remaining = remaining.replace(REAPPROVAL, "");
  return APPROVAL.test(remaining);
}

function clauseIsSafe(clause: string) {
  const normalized = clause.trim();
  if (!normalized || NEGATION.test(normalized)) return true;
  if (hasUnsafeApproval(normalized)) return false;
  return !SEND_OR_READY.test(normalized) && !EXTERNALIZATION.test(normalized);
}

/** True only when every affirmative draft-safety claim is absent from the reply. */
export function isDraftRevisionReplySafe(reply: string) {
  return reply.split(CLAUSE_BREAK).every(clauseIsSafe);
}
