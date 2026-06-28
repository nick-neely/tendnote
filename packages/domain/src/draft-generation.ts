import type { MessageDraftChannel, MessageDraftPurpose } from "./drafts";

/**
 * The grounded context the draft-generation adapter turns into message prose
 * (PRD #75, issue #77). Every field is already trust-classified and policy-
 * filtered by the generator before it reaches here, so the adapter never has to
 * re-apply privacy rules: `facts` are confirmed (approved memories), `loggedContext`
 * is "you noted/mentioned" material (source records), and `tentative` are
 * unreviewed hints that must never be stated as fact (ADR-0004). `followupReason`
 * and `briefReason` are the intent/entry point that started the draft.
 */
export type DraftGroundedContext = {
  person: { displayName: string; relationshipType?: string };
  channel: MessageDraftChannel;
  purpose: MessageDraftPurpose;
  facts: string[];
  loggedContext: string[];
  tentative: string[];
  followupReason?: string;
  briefReason?: string;
  // Optional user tone request ("warmer", "shorter", "more professional").
  toneInstruction?: string;
};

export type DraftGenerationResult = {
  body: string;
  provenance: Record<string, unknown>;
};

/**
 * Whether there is enough grounded context to justify a draft (PRD user story
 * #30). Suggested memories are deliberately excluded: they are tentative hints,
 * not grounding, so a draft built only from unreviewed extraction is refused
 * rather than encouraging fake outreach. A name alone is not enough either.
 */
export function hasGroundedDraftContext(
  ctx: Pick<DraftGroundedContext, "facts" | "loggedContext" | "followupReason" | "briefReason">,
): boolean {
  return (
    ctx.facts.length > 0 ||
    ctx.loggedContext.length > 0 ||
    Boolean(ctx.followupReason) ||
    Boolean(ctx.briefReason)
  );
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

function softLower(text: string): string {
  const trimmed = text.trim().replace(/[.!?]+$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/**
 * Provider-agnostic prompt for the drafting model (PRD #75, issue #77; tone and
 * privacy rules are tightened further in issue #81). It enforces the boundaries
 * deterministic tests cannot: trust-tier phrasing, no invented facts, concise and
 * natural wording, and that the draft stays a Tendnote-only message with no
 * external send or provider draft. Source grounding is supplied as the structured
 * context above, never as raw ids.
 */
export function buildDraftPrompt(ctx: DraftGroundedContext): string {
  const lines: string[] = [
    `You are drafting a private ${ctx.channel} message the user will review before sending themselves.`,
    `Write to ${ctx.person.displayName}${
      ctx.person.relationshipType ? ` (${ctx.person.relationshipType})` : ""
    }. Purpose: ${ctx.purpose}.`,
    "Rules:",
    "- Sound like a thoughtful note from the user, not a greeting card. Avoid fake sentimentality.",
    "- Be concise and natural. Do not invent facts, events, or feelings that are not provided below.",
    "- Confirmed facts may be stated plainly. Logged context should be referenced gently ('I know we talked about…').",
    "- Tentative hints are unreviewed: you may allude to them softly as a question, never as fact, and prefer to omit them if unsure.",
    "- This is a Tendnote-only draft. Never claim to have sent it, scheduled it, or created an external/Gmail draft.",
    ctx.channel === "email"
      ? "- Output light Markdown suited to email: separate paragraphs with a blank line, and use *occasional* bold, italics, a link, or a short list only when it genuinely helps. Default to plain prose; never over-format a short note."
      : "- Write plain prose with no Markdown formatting; a text or chat message should read as plain text.",
  ];

  if (ctx.followupReason) {
    lines.push(`Reason for reaching out: ${ctx.followupReason}`);
  }
  if (ctx.briefReason) {
    lines.push(`Why this surfaced: ${ctx.briefReason}`);
  }
  if (ctx.facts.length > 0) {
    lines.push(`Confirmed facts:\n${ctx.facts.map((f) => `- ${f}`).join("\n")}`);
  }
  if (ctx.loggedContext.length > 0) {
    lines.push(`Logged context:\n${ctx.loggedContext.map((c) => `- ${c}`).join("\n")}`);
  }
  if (ctx.tentative.length > 0) {
    lines.push(`Tentative (unconfirmed) hints:\n${ctx.tentative.map((t) => `- ${t}`).join("\n")}`);
  }
  if (ctx.toneInstruction) {
    lines.push(`Tone request: ${ctx.toneInstruction}`);
  }

  return lines.join("\n");
}

/**
 * Deterministic, source-grounded draft used when no drafting model is configured
 * and as the fakeable default in tests (mirrors the brief summary fallback). It
 * only ever references context that was actually supplied — it never invents a
 * fact and never asserts a tentative hint — so the no-fake-memory and
 * source-grounding guarantees hold without a live model (PRD testing decisions).
 */
export function generateDeterministicDraft(ctx: DraftGroundedContext): DraftGenerationResult {
  const name = firstName(ctx.person.displayName);
  const parts: string[] = [];

  if (ctx.purpose === "birthday") {
    parts.push(`Happy birthday, ${name}!`);
  } else if (ctx.purpose === "thank_you") {
    parts.push(`Hi ${name}, thank you — I really appreciate it.`);
  } else {
    parts.push(`Hi ${name},`);
  }

  if (ctx.followupReason) {
    parts.push(`I've been meaning to follow up — ${softLower(ctx.followupReason)}.`);
  } else if (ctx.briefReason && ctx.purpose !== "birthday") {
    parts.push(`you came to mind today — ${softLower(ctx.briefReason)}.`);
  } else if (ctx.purpose !== "birthday" && ctx.purpose !== "thank_you") {
    parts.push("it's been a little while and I wanted to check in.");
  }

  const [topFact] = ctx.facts;
  const [topLogged] = ctx.loggedContext;
  if (topFact) {
    parts.push(`I remember ${softLower(topFact)}.`);
  } else if (topLogged) {
    parts.push(`I know we talked about ${softLower(topLogged)}.`);
  }

  parts.push("How have you been?");

  return {
    body: parts.join(" "),
    provenance: {
      generator: "deterministic",
      usedFacts: ctx.facts.length,
      usedLoggedContext: ctx.loggedContext.length,
      // Tentative hints are intentionally never asserted by the deterministic body.
      omittedTentative: ctx.tentative.length,
    },
  };
}
