import { describe, expect, it } from "vitest";
import { explicitMemoryTriggers, parseExplicitMemoryRequest } from "./memories";

describe("parseExplicitMemoryRequest", () => {
  it("exposes the canonical explicit-memory triggers", () => {
    expect(explicitMemoryTriggers).toEqual(["remember", "save", "note", "keep track of"]);
  });

  it("recognizes a bare remember request and strips the trigger", () => {
    expect(parseExplicitMemoryRequest("Remember Caleb is moving to Denver in August")).toEqual({
      isExplicitMemoryRequest: true,
      trigger: "remember",
      content: "Caleb is moving to Denver in August",
    });
  });

  it("strips a 'remember that' connective", () => {
    expect(parseExplicitMemoryRequest("Remember that Mark prefers short texts")).toMatchObject({
      isExplicitMemoryRequest: true,
      trigger: "remember",
      content: "Mark prefers short texts",
    });
  });

  it("strips a 'remember to' connective", () => {
    expect(parseExplicitMemoryRequest("please remember to call Mom on Sunday")).toMatchObject({
      isExplicitMemoryRequest: true,
      trigger: "remember",
      content: "call Mom on Sunday",
    });
  });

  it("recognizes a save request with a colon separator", () => {
    expect(parseExplicitMemoryRequest("save: Nina is training for a fall marathon")).toMatchObject({
      isExplicitMemoryRequest: true,
      trigger: "save",
      content: "Nina is training for a fall marathon",
    });
  });

  it("recognizes a note request", () => {
    expect(parseExplicitMemoryRequest("Note that Priya likes morning coffee chats")).toMatchObject({
      isExplicitMemoryRequest: true,
      trigger: "note",
      content: "Priya likes morning coffee chats",
    });
  });

  it("normalizes 'make a note of' to the note trigger", () => {
    expect(parseExplicitMemoryRequest("Make a note of Sam's new job")).toMatchObject({
      isExplicitMemoryRequest: true,
      trigger: "note",
      content: "Sam's new job",
    });
  });

  it("recognizes a keep track of request", () => {
    expect(parseExplicitMemoryRequest("Keep track of Theo's move in September")).toMatchObject({
      isExplicitMemoryRequest: true,
      trigger: "keep track of",
      content: "Theo's move in September",
    });
  });

  it("is case-insensitive", () => {
    expect(parseExplicitMemoryRequest("REMEMBER Dana switched teams")).toMatchObject({
      isExplicitMemoryRequest: true,
      trigger: "remember",
      content: "Dana switched teams",
    });
  });

  it("does not match trigger words embedded in other words", () => {
    expect(parseExplicitMemoryRequest("Saved searches are handy")).toMatchObject({
      isExplicitMemoryRequest: false,
      trigger: null,
    });
    expect(parseExplicitMemoryRequest("Her notebook is full")).toMatchObject({
      isExplicitMemoryRequest: false,
      trigger: null,
    });
  });

  it("treats casual logged context as a non-explicit request", () => {
    expect(parseExplicitMemoryRequest("Had lunch with Mark. He may be switching jobs.")).toEqual({
      isExplicitMemoryRequest: false,
      trigger: null,
      content: "Had lunch with Mark. He may be switching jobs.",
    });
  });

  it("returns empty content when only a trigger word is provided", () => {
    expect(parseExplicitMemoryRequest("remember")).toEqual({
      isExplicitMemoryRequest: true,
      trigger: "remember",
      content: "",
    });
  });
});
