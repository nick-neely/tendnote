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
    expect(followUpSuggestions([personContext])).toEqual([
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

    expect(followUpSuggestions([draft])).toEqual(["Make it shorter", "Make it warmer"]);
  });

  it("asks what else is known after something was written down", () => {
    expect(followUpSuggestions([savedMemory])).toEqual(["What else do I know about Priya Shah?"]);
  });

  it("says nothing when the turn never named a person", () => {
    const nameless: AssistantToolView = { ...savedMemory, personName: null };

    expect(followUpSuggestions([nameless])).toEqual([]);
  });

  it("names whoever the turn named first, across result kinds", () => {
    const added: AssistantToolView = {
      displayName: "Jordan Rivera",
      kind: "added_person",
      personId: "person-2",
      relationshipType: null,
    };

    expect(followUpSuggestions([added, { ...savedMemory, personName: null }])).toEqual([
      "What else do I know about Jordan Rivera?",
    ]);
  });

  it("offers nothing for a turn that just looked something up", () => {
    const search: AssistantToolView = { kind: "relationship_context_search", results: [] };

    expect(followUpSuggestions([search])).toEqual([]);
    expect(followUpSuggestions([])).toEqual([]);
  });

  it("never offers more than three, and never the same one twice", () => {
    const suggestions = followUpSuggestions([
      personContext,
      savedMemory,
      { candidates: [], kind: "relationship_agenda", window: null },
      savedMemory,
    ]);

    expect(suggestions).toEqual([
      "Draft a check-in to Priya Shah",
      "Add a follow-up for Priya Shah",
      "What else do I know about Priya Shah?",
    ]);
  });
});
