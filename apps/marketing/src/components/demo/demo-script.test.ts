import { describe, expect, it } from "vitest";
import {
  type DemoAction,
  type DemoState,
  days,
  demoReducer,
  initialDemoState,
  questions,
  STEP_COUNT,
  steps,
} from "./demo-script";

function play(...actions: DemoAction[]): DemoState {
  return actions.reduce(demoReducer, initialDemoState);
}

const toTheAnswer: DemoAction[] = [
  { type: "send" },
  { type: "approve" },
  { type: "schedule", day: "monday" },
  { type: "ask", question: "when" },
];

describe("the demo story", () => {
  it("follows the spec's five steps in order", () => {
    expect(steps.map((step) => step.id)).toEqual([
      "capture",
      "memory",
      "followup",
      "ask",
      "reminder",
    ]);
    expect(STEP_COUNT).toBe(5);
  });

  it("rolls the days forward from Wednesday to each day the visitor can pick", () => {
    for (const day of days) {
      expect(day.roll[0]).toBe("Wednesday");
      expect(day.roll.at(-1)).toBe(day.name);
    }
  });

  it("answers every supplied question from the note alone", () => {
    for (const question of questions) {
      for (const day of days) {
        expect(question.answer(day)).toMatch(/design studio/);
      }
    }
  });
});

describe("demoReducer", () => {
  it("moves one step per action and lands on the reminder after the jump", () => {
    const answered = play(...toTheAnswer);
    expect(answered).toMatchObject({
      step: 4,
      arrived: false,
      day: "monday",
      question: "when",
    });
    expect(answered.announcement).toMatch(/^Scripted answer: Thursday\./);
    expect(answered.announcement).toMatch(/checking in with Sam on Monday/);

    const arrived = demoReducer(answered, { type: "jump" });
    expect(arrived.arrived).toBe(true);
    expect(arrived.announcement).toBe(
      "Five days later. Monday, 9:00 AM. A reminder from Tendnote: Ask Sam how the interview went.",
    );
  });

  it("ignores an action that does not belong to the current step", () => {
    const start = play();
    expect(demoReducer(start, { type: "approve" })).toBe(start);
    expect(demoReducer(start, { type: "jump" })).toBe(start);
    const sent = play({ type: "send" });
    expect(demoReducer(sent, { type: "send" })).toBe(sent);
  });

  it("revisits a step with the choices kept, and jumps to the reminder from the list", () => {
    const done = play(...toTheAnswer, { type: "jump" });
    const back = demoReducer(done, { type: "go-to", step: 2 });
    expect(back).toMatchObject({ step: 2, arrived: false, day: "monday" });
    expect(back.announcement).toBe("Step 3 of 5: Pick a day to check in.");

    const ahead = demoReducer(play(), { type: "go-to", step: 4 });
    expect(ahead).toMatchObject({ step: 4, arrived: true, day: "friday" });
  });

  it("clamps a step outside the story", () => {
    expect(demoReducer(play(), { type: "go-to", step: 99 }).step).toBe(4);
    expect(demoReducer(play(), { type: "go-to", step: -3 }).step).toBe(0);
  });

  it("restarts from a clean slate", () => {
    const restarted = demoReducer(play(...toTheAnswer, { type: "jump" }), { type: "restart" });
    expect({ ...restarted, announcement: "" }).toEqual(initialDemoState);
    expect(restarted.announcement).toBe(
      "Story restarted. Step 1 of 5: Write down what Sam told you.",
    );
  });
});
