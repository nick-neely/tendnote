import { describe, expect, it } from "vitest";
import { isSessionNotActive } from "./session-errors";

/**
 * The difference this predicate draws is the difference between "come back in a
 * moment" and "this conversation is over". Getting it wrong in one direction
 * leaves a composer on screen that will refuse every message; in the other it
 * calls the ordinary end of a 30-day session an outage.
 */
describe("isSessionNotActive", () => {
  it("recognizes eve's own 409, whose code is the authoritative answer", () => {
    // The shape `ClientError` produces for
    // `409 {"code":"session_not_active","error":"The session is no longer active."}`.
    const error = Object.assign(new Error("The session is no longer active."), {
      code: "session_not_active",
      status: 409,
      body: '{"code":"session_not_active","error":"The session is no longer active.","ok":false}',
    });

    expect(isSessionNotActive(error)).toBe(true);
  });

  it("still recognizes it when only the raw body survived", () => {
    const error = Object.assign(new Error("Server returned 409."), {
      body: '{"code":"session_not_active","ok":false}',
    });

    expect(isSessionNotActive(error)).toBe(true);
  });

  /**
   * Reopening a thread the mount will not hand back. Eve retries the 404 about a
   * dozen times before throwing, so by the time this arrives the answer is
   * final: the thread lists and replays, and nothing can ever be added to it.
   */
  it("recognizes the terminal 404 a resume gives up on", () => {
    // What `openStreamBody` throws after exhausting its reconnect budget against
    // `EveSessionNotFoundError`'s deliberately opaque body.
    const error = Object.assign(new Error("Session not found."), {
      name: "ClientError",
      status: 404,
      body: '{"error":"Session not found.","ok":false}',
    });

    expect(isSessionNotActive(error)).toBe(true);
  });

  it("recognizes it from the status alone, whatever the body said", () => {
    // A rewording of the 404 body, or a rethrow that kept only the status, must
    // not quietly downgrade a dead thread back to a live composer.
    expect(isSessionNotActive(Object.assign(new Error("Not Found"), { status: 404 }))).toBe(true);
  });

  it("recognizes a plain Error rebuilt from the response prose", () => {
    expect(isSessionNotActive(new Error("The session is no longer active."))).toBe(true);
  });

  it("recognizes it through a rethrow that kept the code in the message", () => {
    expect(isSessionNotActive(new Error("send failed: session_not_active"))).toBe(true);
  });

  it("leaves an ordinary outage as an outage", () => {
    // A network failure carries no status at all - the next try may well work.
    expect(isSessionNotActive(new Error("Failed to fetch"))).toBe(false);
    expect(
      isSessionNotActive(Object.assign(new Error("Server returned 500."), { status: 500 })),
    ).toBe(false);
    expect(
      isSessionNotActive(Object.assign(new Error("Server returned 503."), { status: 503 })),
    ).toBe(false);
    // A cancelled turn is the owner's own doing and leaves the session usable.
    expect(isSessionNotActive(new Error("The turn was cancelled."))).toBe(false);
  });

  it("says no rather than throwing when handed nothing at all", () => {
    expect(isSessionNotActive(undefined)).toBe(false);
    expect(isSessionNotActive(null)).toBe(false);
    expect(isSessionNotActive("")).toBe(false);
  });
});
