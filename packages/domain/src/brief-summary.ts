import type { BriefCadence, BriefItemKind } from "./briefs";

/**
 * Presentation-only view of a selected brief item passed to summary generation
 * (PRD #65, issue #73). It deliberately carries no source-record ids, ranks, or
 * lifecycle state — the decorative summary must not depend on, or leak, the
 * grounding the deterministic items already own.
 */
export type BriefSummaryItem = {
  kind: BriefItemKind;
  personDisplayName: string | null;
  title: string;
  reason: string;
};

export type BriefSummaryInput = {
  cadence: BriefCadence;
  items: BriefSummaryItem[];
};

export type BriefSummaryResult = {
  summary: string;
  // Narrow provenance for debugging the decorative text only (generator + version).
  provenance: Record<string, unknown>;
};

/** Version tag recorded in provenance for the deterministic summary fallback. */
export const DETERMINISTIC_BRIEF_SUMMARY_VERSION = "brief-summary:1";

function cadenceLabel(cadence: BriefCadence): string {
  return cadence === "weekly" ? "this week" : "today";
}

function uniquePeople(items: BriefSummaryItem[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const item of items) {
    const name = item.personDisplayName?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

function joinNames(names: string[]): string {
  if (names.length === 0) {
    return "a few relationships";
  }

  if (names.length === 1) {
    return names[0] as string;
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, 2).join(", ")}, and ${names.length - 2} more`;
}

/**
 * Builds the prompt for the optional LLM summary line. The model is asked for a
 * single warm sentence over the already-selected items and is explicitly told not
 * to invent people, facts, or actions — it decorates, it does not decide
 * (PRD #65, ADR-0008).
 */
export function buildBriefSummaryPrompt(input: BriefSummaryInput): string {
  const lines = input.items.map((item) => {
    const who = item.personDisplayName ? `${item.personDisplayName}: ` : "";
    return `- ${who}${item.title} — ${item.reason}`;
  });

  return [
    `Write one short, warm sentence summarizing this ${cadenceLabel(input.cadence)} relationship brief.`,
    "Only use the items below. Do not invent people, facts, dates, or actions. Do not add a greeting or sign-off.",
    "",
    lines.join("\n"),
  ].join("\n");
}

/**
 * Deterministic summary fallback (PRD #65, issue #73). It produces a friendly line
 * from the selected items with no model call, so dev and CI get decoration without
 * gateway credentials and the LLM adapter has a safe fallback for empty output.
 */
export function generateDeterministicBriefSummary(input: BriefSummaryInput): BriefSummaryResult {
  const count = input.items.length;
  const noun = count === 1 ? "person" : "people";
  const who = joinNames(uniquePeople(input.items));
  const summary = `${count} ${noun} to keep in mind ${cadenceLabel(input.cadence)}: ${who}.`;

  return {
    summary,
    provenance: { generator: "deterministic", version: DETERMINISTIC_BRIEF_SUMMARY_VERSION },
  };
}
