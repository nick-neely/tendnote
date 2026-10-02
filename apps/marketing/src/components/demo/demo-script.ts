/**
 * The Marketing Demo's story, as data: one fictional friend's job interview,
 * told in five steps the visitor performs. Every name, note, and answer is
 * invented and written in advance; nothing here calls a model, an account, or
 * the product. The reducer is the whole state machine, so the page renders it
 * and the tests drive it without a browser.
 */

export type StepId = "capture" | "memory" | "followup" | "ask" | "reminder";

export type Step = { id: StepId; title: string; body: string };

export const steps: readonly Step[] = [
  {
    id: "capture",
    title: "Write down what Sam told you",
    body: "One sentence, right after coffee. Press Send, and Tendnote works out who it is about.",
  },
  {
    id: "memory",
    title: "Keep what is worth keeping",
    body: "Tendnote suggests a Memory for Sam. Nothing is saved until you approve it.",
  },
  {
    id: "followup",
    title: "Pick a day to check in",
    body: "The interview is Thursday. Choose when to ask how it went, then accept the follow-up.",
  },
  {
    id: "ask",
    title: "Ask about it later",
    body: "A day on, the details are already fuzzy. Pick a question and see where the answer came from.",
  },
  {
    id: "reminder",
    title: "Get the nudge on the day",
    body: "Skip ahead. One reminder arrives on the day you picked, and nothing else.",
  },
];

export const STEP_COUNT = steps.length;
const LAST_STEP = STEP_COUNT - 1;

export const PERSON = "Sam Rivera";

/** The note the story starts with, already in the composer. */
export const NOTE_TEXT =
  "Coffee with Sam. Final-round interview at a design studio on Thursday. Nervous about the portfolio review.";

export const MEMORY_TEXT =
  "Interviewing at a design studio, final round on Thursday. Nervous about the portfolio review.";

export const FOLLOW_UP_TEXT = "Ask Sam how the interview went";

/** The note was written on Tuesday. */
export const NOTE_DAY = "Tuesday";

/** The visitor asks about it a day later, so the answer is recall rather than an echo. */
export const ASK_DAY = "Wednesday";

export type DayId = "friday" | "saturday" | "monday";

export type Day = {
  id: DayId;
  /** The day as the visitor picks it. */
  label: string;
  /** The day as Today and the reminder name it. */
  name: string;
  /** Whole days after Wednesday, when the visitor asked, spelled out for the time jump. */
  later: string;
  /** Every day name the time jump rolls through, Wednesday first. */
  roll: readonly string[];
};

const WEEK = ["Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Monday"];

export const days: readonly Day[] = [
  {
    id: "friday",
    label: "Friday",
    name: "Friday",
    later: "Two days later",
    roll: WEEK.slice(0, 3),
  },
  {
    id: "saturday",
    label: "Saturday",
    name: "Saturday",
    later: "Three days later",
    roll: WEEK.slice(0, 4),
  },
  {
    id: "monday",
    label: "Next Monday",
    name: "Monday",
    later: "Five days later",
    roll: WEEK.slice(0, 6),
  },
];

/** The day Tendnote suggests: the morning after the interview. */
export const SUGGESTED_DAY: DayId = "friday";

/** Reminders arrive at nine in the morning unless the customer picks another time. */
export const REMINDER_TIME = "9:00 AM";

export type QuestionId = "nervous" | "when" | "before";

export type Question = {
  id: QuestionId;
  text: string;
  /** Eve's scripted answer, which can name the follow-up day the visitor chose. */
  answer: (day: Day) => string;
};

export const questions: readonly Question[] = [
  {
    id: "nervous",
    text: "What was Sam nervous about?",
    answer: () =>
      "The portfolio review. It is part of Sam's final-round interview at a design studio on Thursday.",
  },
  {
    id: "when",
    text: "When is Sam's interview?",
    answer: (day) =>
      `Thursday. It is the final round at a design studio, and you are checking in with Sam on ${day.name}.`,
  },
  {
    id: "before",
    text: "Anything I should know before I see Sam?",
    answer: () =>
      "Sam's final-round interview at a design studio is on Thursday, and the portfolio review was the worrying part. Asking how the review went is a kind place to start.",
  },
];

export const ANSWER_SOURCE = `From your note · ${NOTE_DAY}, after coffee`;

export function dayById(id: DayId): Day {
  return days.find((day) => day.id === id) ?? (days[0] as Day);
}

export function questionById(id: QuestionId): Question {
  return questions.find((question) => question.id === id) ?? (questions[0] as Question);
}

/*
 * `step` is the step the visitor is on. Each step waits for its one action;
 * performing it moves to the next. The last step has two moments: the answer
 * with the Skip ahead button still showing, then `arrived` once the visitor
 * has jumped to the reminder day. Choices survive revisiting, so going back to
 * a step shows it ready to do again, and jumping forward fills any choice not
 * yet made with Tendnote's suggestion.
 */
export type DemoState = {
  step: number;
  arrived: boolean;
  day: DayId;
  question: QuestionId;
  /** What a screen reader hears after the last change; empty on first load. */
  announcement: string;
};

export type DemoAction =
  | { type: "send" }
  | { type: "approve" }
  | { type: "schedule"; day: DayId }
  | { type: "ask"; question: QuestionId }
  | { type: "jump" }
  | { type: "go-to"; step: number }
  | { type: "restart" };

export const initialDemoState: DemoState = {
  step: 0,
  arrived: false,
  day: SUGGESTED_DAY,
  question: "nervous",
  announcement: "",
};

function stepLabel(step: number): string {
  const current = steps[step] as Step;
  return `Step ${step + 1} of ${STEP_COUNT}: ${current.title}.`;
}

/** What the visitor sees when the reminder lands, as one sentence. */
function arrivalAnnouncement(day: Day): string {
  return `${day.later}. ${day.name}, ${REMINDER_TIME}. A reminder from Tendnote: ${FOLLOW_UP_TEXT}.`;
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "send":
      if (state.step !== 0) return state;
      return {
        ...state,
        step: 1,
        announcement: `Sent. Tendnote suggests a Memory for ${PERSON}: ${MEMORY_TEXT} ${stepLabel(1)}`,
      };
    case "approve":
      if (state.step !== 1) return state;
      return { ...state, step: 2, announcement: `Saved to memory. ${stepLabel(2)}` };
    case "schedule": {
      if (state.step !== 2) return state;
      const day = dayById(action.day);
      return {
        ...state,
        step: 3,
        day: day.id,
        announcement: `Reminder set for ${day.name}. ${stepLabel(3)}`,
      };
    }
    case "ask": {
      if (state.step !== 3) return state;
      const question = questionById(action.question);
      return {
        ...state,
        step: LAST_STEP,
        arrived: false,
        question: question.id,
        announcement: `Scripted answer: ${question.answer(dayById(state.day))} ${stepLabel(LAST_STEP)}`,
      };
    }
    case "jump":
      if (state.step !== LAST_STEP || state.arrived) return state;
      return { ...state, arrived: true, announcement: arrivalAnnouncement(dayById(state.day)) };
    case "go-to": {
      const step = Math.min(LAST_STEP, Math.max(0, Math.trunc(action.step)));
      // The last step from the list goes straight to the reminder: its question was optional.
      const arrived = step === LAST_STEP;
      return {
        ...state,
        step,
        arrived,
        announcement: arrived ? arrivalAnnouncement(dayById(state.day)) : stepLabel(step),
      };
    }
    case "restart":
      return { ...initialDemoState, announcement: `Story restarted. ${stepLabel(0)}` };
  }
}
