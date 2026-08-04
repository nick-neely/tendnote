import { z } from "zod";
import { selfContextFactCategories } from "./context-fact-categories";
import {
  isPreciseAddressContextFactContent,
  isRestrictedContextFactDisclosure,
  isSensitiveContextFactContent,
  normalizeContextFactContent,
  selfContextFactCategorySchema,
} from "./context-facts";
import { atLeastSensitivity, type Sensitivity, sensitivitySchema } from "./privacy";

/**
 * Importing Self Context from another assistant is one deliberate, bounded session:
 * the owner asks ChatGPT, Claude, or Gemini what it already remembers about them,
 * pastes the answer back, and reviews every candidate before it becomes context.
 *
 * Nothing here trusts the pasted text. It is third-party output about the owner,
 * so it lands as review-gated `suggested` facts with `import` provenance, exactly
 * like the Phase 7.5 contract requires, and never as direct active context.
 */
export const contextFactImportPromptVersion = "context-fact-import.v1";

/** A paste large enough to hold a full memory export, small enough to stay a bounded turn. */
export const MAX_CONTEXT_FACT_IMPORT_TEXT_LENGTH = 16_000;
/** One import proposes a reviewable handful, not an unbounded backlog. */
export const MAX_CONTEXT_FACT_IMPORT_CANDIDATES = 24;
export const MAX_CONTEXT_FACT_IMPORT_EVIDENCE_LENGTH = 240;
/**
 * Past this length a prefilled chat URL stops being reliable across browsers and
 * provider edge servers, so the link degrades to copy-then-open instead of
 * opening a chat with a silently truncated prompt.
 */
const MAX_PREFILLED_PROMPT_URL_LENGTH = 6_000;

/** The fenced language tag the prompt asks for, and the one the parser reads. */
export const CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE = "tendnote-context";

export type ContextFactImportProvider = {
  id: ContextFactImportProviderId;
  name: string;
  /** Where a fresh chat opens. */
  newChatUrl: string;
  /**
   * The query parameter that prefills the composer, when the provider has one.
   * Only ChatGPT does today; the other two get copy-then-open.
   */
  promptParam: string | null;
};

export const contextFactImportProviderSchema = z.enum(["chatgpt", "claude", "gemini"]);
export type ContextFactImportProviderId = z.infer<typeof contextFactImportProviderSchema>;

export const contextFactImportProviders: readonly ContextFactImportProvider[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    // ChatGPT reads `?q=` on load and drops the text into the composer.
    newChatUrl: "https://chatgpt.com/",
    promptParam: "q",
  },
  {
    id: "claude",
    name: "Claude",
    // claude.ai retired its `?q=` prefill; the surviving `claude://` deep link is a
    // desktop-app scheme a browser cannot be assumed to resolve, so this is copy-then-open.
    newChatUrl: "https://claude.ai/new",
    promptParam: null,
  },
  {
    id: "gemini",
    name: "Gemini",
    // Gemini has never shipped a prompt query parameter.
    newChatUrl: "https://gemini.google.com/app",
    promptParam: null,
  },
];

const providerById = new Map(contextFactImportProviders.map((provider) => [provider.id, provider]));

export function contextFactImportProvider(
  id: ContextFactImportProviderId,
): ContextFactImportProvider {
  const provider = providerById.get(id);
  if (!provider) throw new Error(`Unknown Context Fact import provider: ${id}`);
  return provider;
}

/** How Tendnote read a given paste. `block` never leaves the app; `extraction` costs one model call. */
export const contextFactImportSourceSchema = z.enum(["block", "extraction"]);
export type ContextFactImportSource = z.infer<typeof contextFactImportSourceSchema>;

/**
 * The prompt the owner hands to another assistant. It is deliberately short: it has
 * to survive a prefilled URL, and a shorter instruction is followed more faithfully.
 *
 * It asks only for durable, first-person orientation, names the exact categories
 * Tendnote stores, and refuses the classes of content Context Facts must never hold.
 */
export function buildContextFactImportPrompt(input: { returnUrl: string }): string {
  return [
    "I use a private notebook app called Tendnote. It keeps a short list of durable facts about me so I don't have to repeat myself.",
    "",
    "Using only what you already remember about me from our past conversations, list those facts. Follow these rules exactly:",
    "",
    "- One short statement per line, first person, present tense.",
    "- Only durable facts: my work, my background, where I'm generally based, lasting interests, and standing preferences or constraints.",
    "- Skip anything temporary, anything about other people, my street address, and any passwords, account numbers, or financial or medical details.",
    "- Never invent a fact. If you don't remember anything durable about me, say so instead of guessing.",
    "",
    "Reply with a single fenced code block in exactly this shape:",
    "",
    "```" + CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE,
    "work | normal | I run a software consultancy.",
    "location | normal | I'm based in Chicago.",
    "interest | normal | I follow trail running.",
    "preference | sensitive | I'd rather not talk on the phone.",
    "```",
    "",
    `The first field is one of: ${selfContextFactCategories.join(", ")}.`,
    "The second is normal, or sensitive when the fact is something I'd want handled carefully.",
    "",
    `After the block, add one line: "Copy the block above, then open ${input.returnUrl} and paste it in."`,
  ].join("\n");
}

export type ContextFactImportProviderLink = {
  href: string;
  /** True when the chat opens with the prompt already in the composer. */
  prefilled: boolean;
};

export function buildContextFactImportProviderLink(
  provider: ContextFactImportProvider,
  prompt: string,
): ContextFactImportProviderLink {
  if (!provider.promptParam) return { href: provider.newChatUrl, prefilled: false };

  const url = new URL(provider.newChatUrl);
  url.searchParams.set(provider.promptParam, prompt);
  const href = url.toString();
  return href.length > MAX_PREFILLED_PROMPT_URL_LENGTH
    ? { href: provider.newChatUrl, prefilled: false }
    : { href, prefilled: true };
}

/**
 * One paste, bounded. Both the server action and the query layer validate against
 * this same schema so the owner cannot be told two different things about the
 * same paste depending on which boundary rejected it first.
 */
export const contextFactImportTextSchema = z
  .string()
  .trim()
  .min(1, "Paste what the assistant gave you.")
  .max(
    MAX_CONTEXT_FACT_IMPORT_TEXT_LENGTH,
    "That paste is too long. Bring over the list of facts rather than the whole conversation.",
  );

export const contextFactImportCandidateSchema = z
  .object({
    category: selfContextFactCategorySchema,
    content: z.string().trim().min(1).max(500),
    evidence: z.string().trim().min(1).max(MAX_CONTEXT_FACT_IMPORT_EVIDENCE_LENGTH),
    sensitivity: sensitivitySchema.optional(),
  })
  .strict();

export type ContextFactImportCandidate = z.infer<typeof contextFactImportCandidateSchema>;

export const contextFactImportAdapterResultSchema = z.object({
  candidates: z.array(z.unknown()).default([]),
});

export type ContextFactImportAdapterResult = z.infer<typeof contextFactImportAdapterResultSchema>;

export type ContextFactImportExtractionInput = {
  /** Only the current paste is allowed into an adapter. No owner history travels with it. */
  text: string;
};

export type ContextFactImportExtractionAdapter = {
  kind: "deterministic" | "fake" | "llm";
  model?: string;
  promptVersion?: string;
  extractCandidates: (
    input: ContextFactImportExtractionInput,
  ) => Promise<ContextFactImportAdapterResult>;
};

/**
 * A narrower guard than ambient extraction's. Ambient has to distrust a model
 * reading a passing remark, so it also rejects habits, routines, and stated
 * preferences. An import is the owner's own assistant reporting what the owner
 * told it to remember, so those are exactly the facts worth keeping; only
 * time-bound states and inferred persona are still out of bounds.
 */
const nonDurableImportPattern =
  /\b(?:today|tonight|tomorrow|yesterday|this (?:week|month|morning|afternoon|evening)|last (?:week|month|night)|next (?:week|month)|right now|at the moment|currently|lately|recently|temporar(?:y|ily)|feeling)\b/i;

const inferredPersonaImportPattern =
  /\b(?:seems to|appears to|apparently|presumably|probably|likely|may be|might be|personality|introvert|extrovert|good person|bad person)\b/i;

/**
 * Self-assessment stays out for the same reason ambient extraction bans it: a
 * Context Fact is current orientation, not a generated persona, and a claim about
 * how capable or principled someone is orients nothing. This is deliberately
 * narrower than ambient's version, which also refuses the habits, routines, and
 * stated preferences an import exists to carry.
 */
const selfAssessmentImportPattern =
  /\b(?:good at|bad at|great at|skilled|expert|proficient|talented|capable|my abilit(?:y|ies)|i value|my values|i believe in)\b/i;

/**
 * Inference preserves or increases the sensitivity of its evidence and can never
 * downgrade it, so a provider's own `normal` label is a floor to raise, never a ceiling.
 */
function resolvedImportSensitivity(candidate: ContextFactImportCandidate): Sensitivity {
  const floor: Sensitivity = isSensitiveContextFactContent(
    `${candidate.content}\n${candidate.evidence}`,
  )
    ? "restricted"
    : "normal";
  return atLeastSensitivity(floor, candidate.sensitivity);
}

function isImportCandidateAllowed(candidate: ContextFactImportCandidate): boolean {
  for (const value of [candidate.content, candidate.evidence]) {
    if (isPreciseAddressContextFactContent(value)) return false;
    if (isRestrictedContextFactDisclosure(value)) return false;
    if (nonDurableImportPattern.test(value)) return false;
    if (inferredPersonaImportPattern.test(value)) return false;
    if (selfAssessmentImportPattern.test(value)) return false;
  }
  return true;
}

export type ValidateContextFactImportCandidatesResult = {
  validCandidates: ContextFactImportCandidate[];
  rejectedCandidateCount: number;
};

/**
 * The single seam every import candidate passes through, whether it came from the
 * fenced block or the extraction model. It bounds the batch, drops content Context
 * Facts must never hold, raises sensitivity to match the evidence, and collapses
 * repeats so one import cannot propose the same statement twice.
 */
export function validateContextFactImportCandidates(
  adapterResult: unknown,
): ValidateContextFactImportCandidatesResult {
  const parsedResult = contextFactImportAdapterResultSchema.safeParse(adapterResult);
  if (!parsedResult.success) return { validCandidates: [], rejectedCandidateCount: 1 };

  const validCandidates: ContextFactImportCandidate[] = [];
  const seen = new Set<string>();
  let rejectedCandidateCount = 0;

  for (const candidate of parsedResult.data.candidates) {
    const parsed = contextFactImportCandidateSchema.safeParse(candidate);
    if (!parsed.success || !isImportCandidateAllowed(parsed.data)) {
      rejectedCandidateCount += 1;
      continue;
    }

    const identity = `${parsed.data.category}:${normalizeContextFactContent(parsed.data.content)}`;
    if (seen.has(identity)) {
      rejectedCandidateCount += 1;
      continue;
    }

    if (validCandidates.length >= MAX_CONTEXT_FACT_IMPORT_CANDIDATES) {
      rejectedCandidateCount += 1;
      continue;
    }

    seen.add(identity);
    validCandidates.push({ ...parsed.data, sensitivity: resolvedImportSensitivity(parsed.data) });
  }

  return { validCandidates, rejectedCandidateCount };
}

/** What the owner sees as grounding for an imported suggestion: the source, named, plus its words. */
export function contextFactImportEvidence(providerName: string, statement: string): string {
  const prefix = `From your ${providerName} memory: `;
  const room = MAX_CONTEXT_FACT_IMPORT_EVIDENCE_LENGTH - prefix.length - 2;
  const quoted = statement.trim().slice(0, Math.max(1, room));
  return `${prefix}"${quoted}"`;
}

export type ParsedContextFactImportBlock = {
  candidates: ContextFactImportCandidate[];
  /** Lines inside the block that did not match `category | sensitivity | statement`. */
  unreadableLineCount: number;
};

const blockPattern = new RegExp(
  `\`\`\`[ \\t]*${CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE}[ \\t]*\\r?\\n([\\s\\S]*?)(?:\`\`\`|$)`,
  "i",
);

/**
 * Whether this paste holds a block Tendnote can actually read.
 *
 * The surface promises an owner that a recognised paste never leaves the app, so
 * it has to ask exactly the question the import will ask. Merely spotting the
 * fence is not that question: a fence whose lines are all malformed falls through
 * to extraction, and a promise made on the weaker test would be a lie about where
 * the owner's memory is about to go.
 */
export function hasReadableContextFactImportBlock(text: string): boolean {
  // The provider only shapes the evidence wording, which this predicate discards,
  // so the answer is the same whichever assistant the paste turns out to be from.
  const parsed = parseContextFactImportBlock(text, contextFactImportProvider("chatgpt"));
  return (parsed?.candidates.length ?? 0) > 0;
}

type ImportBlockLine = { candidate?: ContextFactImportCandidate; unreadable: boolean };

function readBlockLine(line: string, provider: ContextFactImportProvider): ImportBlockLine {
  const [category, sensitivity, content, ...extra] = line.split("|").map((field) => field.trim());
  if (extra.length > 0 || category === undefined || sensitivity === undefined || !content) {
    return { unreadable: true };
  }

  const parsed = contextFactImportCandidateSchema.safeParse({
    category: category.toLowerCase(),
    content,
    evidence: contextFactImportEvidence(provider.name, content),
    sensitivity: sensitivity.toLowerCase(),
  });
  return parsed.success ? { candidate: parsed.data, unreadable: false } : { unreadable: true };
}

/**
 * The fast path. When the assistant produced the requested rows, Tendnote reads
 * them here and no part of the paste reaches a model, which is both instant and
 * the more private of the two routes. Returns null when there is nothing to read,
 * which is the caller's signal to fall back to extraction.
 *
 * The fence is optional, because in practice it is usually gone. Every assistant
 * renders a fenced block with its own copy button, and that button copies the
 * block's *contents* - so the paste an owner actually makes is bare rows with no
 * fence around them. Requiring the fence would send the common case to the model.
 *
 * A row is self-identifying enough to read without one: three pipe-delimited
 * fields whose first is a known category and whose second is a known sensitivity.
 * Ordinary prose does not collide with that, so unfenced text is read row by row
 * and everything else in it is simply not a row. Inside a fence every non-empty
 * line was meant to be one, so anything unparsed there is still counted as
 * unreadable; outside one, only a line carrying a `|` was making the attempt.
 */
export function parseContextFactImportBlock(
  text: string,
  provider: ContextFactImportProvider,
): ParsedContextFactImportBlock | null {
  const fenced = blockPattern.exec(text)?.[1];
  const body = fenced ?? text;

  const candidates: ContextFactImportCandidate[] = [];
  let unreadableLineCount = 0;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (fenced === undefined && !line.includes("|")) continue;

    const read = readBlockLine(line, provider);
    if (read.candidate) candidates.push(read.candidate);
    else unreadableLineCount += 1;
  }

  // Unfenced, the rows are the only evidence this was a Tendnote paste at all, so
  // finding none means there is nothing here to read rather than a broken block.
  if (fenced === undefined && candidates.length === 0) return null;
  return { candidates, unreadableLineCount };
}

export function createDeterministicContextFactImportExtractionAdapter(): ContextFactImportExtractionAdapter {
  return {
    kind: "deterministic",
    promptVersion: contextFactImportPromptVersion,
    async extractCandidates() {
      // Without a model, loose prose yields nothing. The owner is told to ask their
      // assistant for the block instead, rather than being handed invented facts.
      return { candidates: [] };
    },
  };
}

export function createFakeContextFactImportExtractionAdapter(
  candidates: ContextFactImportCandidate[],
): ContextFactImportExtractionAdapter {
  return {
    kind: "fake",
    promptVersion: contextFactImportPromptVersion,
    async extractCandidates() {
      return { candidates };
    },
  };
}
