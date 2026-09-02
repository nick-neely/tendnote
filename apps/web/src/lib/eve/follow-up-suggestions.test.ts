import { describe, expect, it } from "vitest";
import { followUpSuggestions } from "./follow-up-suggestions";
import type { AssistantToolView } from "./tool-result-view";

/**
 * A follow-up chip is a promise that tapping it does something. These pin the
 * two ways that promise breaks: offering a next step for a turn that has nothing
 * to follow up on, and naming a person the turn never actually named.
 */

const personContext: AssistantToolView = {
  approvedCount: 1,
  kind: "person_context",
  loggedCount: 3,
  personId: "person-1",
  personName: "Priya Shah",
  snapshotStatus: "fresh",
  suggestedCount: 0,
};

const savedMemory: AssistantToolView = {
  content: "Allergic to shellfish",
  kind: "saved_memory",
  memoryId: "mem-1",
  personId: "person-1",
  personName: "Priya Shah",
  sourceRecordId: null,
};

describe("followUpSuggestions", () => {
  it("offers the two things you can actually do with a person you just recalled", () => {
    expect(followUpSuggestions({ views: [personContext] })).toEqual([
      "Draft a check-in to Priya Shah",
      "Add a follow-up for Priya Shah",
    ]);
  });

  it("offers revisions when a draft is on screen", () => {
    const draft: AssistantToolView = {
      body: "Hi Priya —",
      draftId: "draft-1",
      grounding: [],
      kind: "message_draft",
      personId: "person-1",
      status: "draft",
    };

    expect(followUpSuggestions({ views: [draft] })).toEqual(["Make it shorter", "Make it warmer"]);
  });

  it("asks what else is known after something was written down", () => {
    expect(followUpSuggestions({ views: [savedMemory] })).toEqual([
      "What else do I know about Priya Shah?",
    ]);
  });

  it("says nothing when the turn never named a person", () => {
    const nameless: AssistantToolView = { ...savedMemory, personName: null };

    expect(followUpSuggestions({ views: [nameless] })).toEqual([]);
  });

  it("names whoever the turn named first, across result kinds", () => {
    const added: AssistantToolView = {
      displayName: "Jordan Rivera",
      kind: "added_person",
      personId: "person-2",
      relationshipType: null,
    };

    expect(followUpSuggestions({ views: [added, { ...savedMemory, personName: null }] })).toEqual([
      "What else do I know about Jordan Rivera?",
    ]);
  });

  it("offers nothing for a turn that just looked something up", () => {
    const search: AssistantToolView = { kind: "relationship_context_search", results: [] };

    expect(followUpSuggestions({ views: [search] })).toEqual([]);
    expect(followUpSuggestions({ views: [] })).toEqual([]);
  });

  it("never offers more than three, and never the same one twice", () => {
    const suggestions = followUpSuggestions({
      views: [
        personContext,
        savedMemory,
        { candidates: [], kind: "relationship_agenda", window: null },
        savedMemory,
      ],
    });

    expect(suggestions).toEqual([
      "Draft a check-in to Priya Shah",
      "Add a follow-up for Priya Shah",
      "What else do I know about Priya Shah?",
    ]);
  });
});

/**
 * The model reads the answer it just wrote, so where it has an opinion about
 * what comes next it is the better one. The rules that matter are which source
 * wins, and that neither source is allowed to offer the reader their own words
 * back.
 */
describe("followUpSuggestions (the model's own proposals)", () => {
  it("prefers what the model proposed over what the results imply", () => {
    expect(
      followUpSuggestions({
        proposed: ["Tell me about her sister", "When did we last talk?"],
        views: [personContext],
      }),
    ).toEqual(["Tell me about her sister", "When did we last talk?"]);
  });

  it("falls back to the derived list only when the tool never ran", () => {
    expect(followUpSuggestions({ proposed: null, views: [personContext] })).toEqual([
      "Draft a check-in to Priya Shah",
      "Add a follow-up for Priya Shah",
    ]);
  });

  /**
   * An empty array is the model saying "nothing useful comes next", which is an
   * answer. Falling through to the derived chips there would overrule it with a
   * guess.
   */
  it("shows nothing when the model looked and had nothing to offer", () => {
    expect(followUpSuggestions({ proposed: [], views: [personContext] })).toEqual([]);
  });

  it("trims, drops blanks, deduplicates, and never offers more than three", () => {
    expect(
      followUpSuggestions({
        proposed: ["  Draft it  ", "", "   ", "Draft it", "Second", "Third", "Fourth"],
        views: [],
      }),
    ).toEqual(["Draft it", "Second", "Third"]);
  });

  it("never offers back a question the reader already asked in this thread", () => {
    expect(
      followUpSuggestions({
        asked: ["What about Priya?", "  when did we LAST talk??  "],
        proposed: ["When did we last talk?", "What about Priya", "Tell me about her sister"],
        views: [],
      }),
    ).toEqual(["Tell me about her sister"]);
  });

  it("never offers back one of the starters that opened the conversation", () => {
    expect(
      followUpSuggestions({
        proposed: ["Who should I reach out to this week?", "Draft a check-in to Priya"],
        views: [],
      }),
    ).toEqual(["Draft a check-in to Priya"]);
  });

  /** The same filter has to reach the derived chips, which can repeat too. */
  it("strikes an already-asked question out of the derived list as well", () => {
    expect(
      followUpSuggestions({
        asked: ["Draft a check-in to Priya Shah"],
        views: [personContext],
      }),
    ).toEqual(["Add a follow-up for Priya Shah"]);
  });
});
