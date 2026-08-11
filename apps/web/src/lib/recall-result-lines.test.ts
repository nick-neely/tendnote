import type { GlobalRecallResult } from "@tendnote/domain/global-recall";
import { describe, expect, it } from "vitest";
import { recallResultLines } from "./recall-result-lines";

/**
 * The rule both recall surfaces read. The palette and the phone's Search flow
 * each prove they are wired to it in their own DOM suite; what a row *says*
 * belongs here, where every family can be stated in one place.
 */

const base = {
  lifecycle: "active",
  match: { kind: "exact" as const, reason: "Matched wording", excerpt: "coffee" },
  sensitivity: "normal" as const,
  visibility: null,
  parent: null,
};

function personResult(): GlobalRecallResult {
  return {
    ...base,
    family: "person",
    canonical: { kind: "person", id: "person-jordan" },
    label: "Jordan Rivera",
    supportingText: "Friend from the climbing gym",
    trust: "identity_reference",
    grounding: [{ kind: "person", id: "person-jordan" }],
    href: "/people/person-jordan",
    details: { displayName: "Jordan Rivera" },
  };
}

function memoryResult({
  personDisplayName = "Jordan Rivera" as string | null,
  text = "Prefers morning coffee chats",
} = {}): GlobalRecallResult {
  return {
    ...base,
    family: "relationship_context",
    canonical: { kind: "memory", id: "memory-1" },
    // The shared normalizer heads a memory with the person it is about.
    label: "Jordan Rivera",
    supportingText: text,
    trust: "confirmed_fact",
    grounding: [{ kind: "memory", id: "memory-1" }],
    href: "/people/person-jordan#memory-memory-1",
    details: { contextKind: "memory", personDisplayName },
  };
}

function savedItemResult({ supportingText = "Renewal notes" } = {}): GlobalRecallResult {
  return {
    ...base,
    family: "saved_item",
    canonical: { kind: "saved_item", id: "saved-1" },
    label: "Climbing gym membership",
    supportingText,
    trust: "saved_context",
    grounding: [{ kind: "saved_item", id: "saved-1" }],
    href: "/saved-items#saved-item-saved-1",
    details: { kind: "note" },
  };
}

function householdContextResult(
  content = "Two adults and one child live here.",
): GlobalRecallResult {
  return {
    ...base,
    family: "household_context",
    canonical: { kind: "context_fact", id: "household-fact-1" },
    label: content,
    supportingText: "Composition",
    trust: "household_context",
    visibility: { choice: "whole_household", label: "Whole household" },
    grounding: [{ kind: "context_fact", id: "household-fact-1" }],
    href: "/account/household/context#household-context-fact-household-fact-1",
    details: {
      content,
      category: "composition",
      categoryLabel: "Composition",
      provenance: { channel: "account", origin: "direct" },
    },
  };
}

function selfContextResult(content = "Two adults and one child live here."): GlobalRecallResult {
  return {
    ...base,
    family: "self_context",
    canonical: { kind: "context_fact", id: "self-fact-1" },
    label: content,
    supportingText: "Background",
    trust: "self_context",
    visibility: { choice: "only_me", label: "Only me" },
    grounding: [{ kind: "context_fact", id: "self-fact-1" }],
    href: "/account/about-you#context-fact-self-fact-1",
    details: {
      content,
      category: "background",
      categoryLabel: "Background",
      provenance: { channel: "account", origin: "direct" },
    },
  };
}

describe("recallResultLines", () => {
  /**
   * The regression: recall labels a memory with the person it is about, so a
   * search for a name produced "Jordan Rivera" as the person's headline and
   * "Jordan Rivera" again for every memory about them - one record apparently
   * listed several times, with the rows indistinguishable from each other.
   */
  it("leads a memory with what was remembered and trails with the person", () => {
    expect(recallResultLines(memoryResult())).toEqual({
      primary: "Prefers morning coffee chats",
      secondary: "Jordan Rivera",
    });
    expect(recallResultLines(memoryResult({ text: "Moving to Denver in the spring" }))).toEqual({
      primary: "Moving to Denver in the spring",
      secondary: "Jordan Rivera",
    });
  });

  /** Logged context is the same family and gets the same treatment. */
  it("treats logged context the same as a confirmed memory", () => {
    const logged: GlobalRecallResult = {
      ...base,
      family: "relationship_context",
      // Logged context is canonically the person it was said about.
      canonical: { kind: "person", id: "person-jordan" },
      label: "Jordan Rivera",
      supportingText: "Said the dishwasher started leaking",
      trust: "logged_context",
      grounding: [{ kind: "source_record", id: "record-1" }],
      href: "/people/person-jordan",
      details: { contextKind: "logged_context", personDisplayName: "Jordan Rivera" },
    };

    expect(recallResultLines(logged)).toEqual({
      primary: "Said the dishwasher started leaking",
      secondary: "Jordan Rivera",
    });
  });

  /**
   * `personDisplayName` is nullable on the contract. The normalizer's label is
   * the same name when there is one, so it is what the context line falls back to.
   */
  it("falls back to the label when the memory carries no person name", () => {
    expect(recallResultLines(memoryResult({ personDisplayName: null }))).toEqual({
      primary: "Prefers morning coffee chats",
      secondary: "Jordan Rivera",
    });
  });

  /** Every other family already leads with its own label; this is a pass-through. */
  it("passes every other family through label-then-supporting-text", () => {
    expect(recallResultLines(personResult())).toEqual({
      primary: "Jordan Rivera",
      secondary: "Friend from the climbing gym",
    });
    expect(recallResultLines(savedItemResult())).toEqual({
      primary: "Climbing gym membership",
      secondary: "Renewal notes",
    });
  });

  /**
   * The phone's Search flow groups by match strength, so there is no family
   * heading over these rows to say whose statement it is. Two members can word
   * the same fact about themselves and about the household identically, and
   * "Only me" against "Whole household" alone reads as an audience setting
   * rather than a different subject.
   */
  it("names the household on a household row so it cannot read as a private one", () => {
    expect(recallResultLines(householdContextResult())).toEqual({
      primary: "Two adults and one child live here.",
      secondary: "Household Context · Composition",
    });
    expect(recallResultLines(selfContextResult())).toEqual({
      primary: "Two adults and one child live here.",
      secondary: "Background",
    });
  });

  /**
   * A Saved Item with no content falls back to its own title for supporting
   * text, and a memory about a person whose name *is* the remembered wording
   * would repeat itself. A row never says the same thing twice.
   */
  it("drops a context line that would only repeat the headline", () => {
    expect(
      recallResultLines(savedItemResult({ supportingText: "Climbing gym membership" })),
    ).toEqual({ primary: "Climbing gym membership", secondary: null });
    expect(recallResultLines(memoryResult({ text: "Jordan Rivera" }))).toEqual({
      primary: "Jordan Rivera",
      secondary: null,
    });
  });
});
