import { expect, it } from "vitest";
import { assistantReturnTo, assistantSurfaceModel } from "./surface-model";

const HINTS = { nudges: [], suggestPersonName: null };

function storedConversation(
  overrides: {
    sessionId?: string;
    title?: string;
    lastActivityAt?: Date;
    archivedAt?: Date | null;
  } = {},
) {
  return {
    archivedAt: null,
    lastActivityAt: new Date("2026-03-01T10:00:00Z"),
    sessionId: "wrun_one",
    title: "Notes on Jordan",
    ...overrides,
  };
}

it("sends an unauthenticated visitor back to the thread they asked for", () => {
  expect(assistantReturnTo("wrun one/two")).toBe("/assistant/wrun%20one%2Ftwo");
  expect(assistantReturnTo(null)).toBe("/assistant");
});

it("hands the page every thread, with archived rows carried as a flag", () => {
  const model = assistantSurfaceModel({
    conversations: [
      storedConversation(),
      storedConversation({ archivedAt: new Date("2026-02-01T10:00:00Z"), sessionId: "wrun_two" }),
    ],
    hints: HINTS,
    ownerUserId: "owner-1",
    sessionId: null,
    thread: null,
  });

  expect(model.found).toBe(true);
  if (!model.found) return;
  expect(model.props.conversations).toEqual([
    {
      archived: false,
      lastActivityAt: new Date("2026-03-01T10:00:00Z"),
      sessionId: "wrun_one",
      title: "Notes on Jordan",
    },
    {
      archived: true,
      lastActivityAt: new Date("2026-03-01T10:00:00Z"),
      sessionId: "wrun_two",
      title: "Notes on Jordan",
    },
  ]);
  expect(model.props.sessionId).toBeNull();
  expect(model.props.ownerUserId).toBe("owner-1");
});

it("opens the thread the URL names once the owner-scoped read returned it", () => {
  const model = assistantSurfaceModel({
    conversations: [storedConversation()],
    hints: { nudges: [], suggestPersonName: "Priya Shah" },
    ownerUserId: "owner-1",
    sessionId: "wrun_one",
    thread: { sessionId: "wrun_one" },
  });

  expect(model.found).toBe(true);
  if (!model.found) return;
  expect(model.props.sessionId).toBe("wrun_one");
  expect(model.props.suggestPersonName).toBe("Priya Shah");
});

/**
 * The one answer that matters for ADR 0219: a session id that is not this
 * owner's and one that never existed have to arrive at the same verdict, so the
 * URL cannot be asked whether someone else's thread is there.
 */
it("refuses a named thread the owner-scoped read did not return", () => {
  for (const conversations of [[], [storedConversation()]]) {
    expect(
      assistantSurfaceModel({
        conversations,
        hints: HINTS,
        ownerUserId: "owner-1",
        sessionId: "wrun_someone_else",
        thread: null,
      }),
    ).toEqual({ found: false });
  }
});
