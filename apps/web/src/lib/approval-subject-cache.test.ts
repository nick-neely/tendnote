import { afterEach, describe, expect, it } from "vitest";
import {
  APPROVAL_SUBJECT_MISSING,
  claimApprovalSubjectLookup,
  readApprovalSubject,
  resetApprovalSubjectCache,
  settleApprovalSubject,
  subscribeApprovalSubject,
} from "./approval-subject-cache";

afterEach(() => {
  resetApprovalSubjectCache();
});

function describedAs(title: string) {
  return { status: "described", subject: { title, lines: [] } } as const;
}

/** Comfortably past the cache's own bound, whatever that is tuned to. */
const PAST_THE_BOUND = 400;

function fillPastTheBound(): void {
  for (let index = 0; index < PAST_THE_BOUND; index += 1) {
    const toolCallId = `call-${index}`;
    claimApprovalSubjectLookup(toolCallId);
    settleApprovalSubject(toolCallId, describedAs(`Record ${index}`));
  }
}

describe("claimApprovalSubjectLookup (one owner-scoped read per parked call)", () => {
  it("grants the read once and refuses every later claim on the same call", () => {
    expect(claimApprovalSubjectLookup("call-1")).toBe(true);
    expect(claimApprovalSubjectLookup("call-1")).toBe(false);
    expect(claimApprovalSubjectLookup("call-2")).toBe(true);
  });
});

describe("settleApprovalSubject / readApprovalSubject", () => {
  it("answers pending until a lookup lands, then keeps the answer for later readers", () => {
    // Claimed first, as the hook does: an answer only lands for a lookup the
    // cache started, so that is the shape every case here uses.
    claimApprovalSubjectLookup("call-1");
    expect(readApprovalSubject("call-1").status).toBe("pending");

    settleApprovalSubject("call-1", describedAs("Accept a follow-up with Mara"));

    // The settled status line is a different component in the same slot, so what
    // matters is that the answer outlives whoever asked for it.
    const state = readApprovalSubject("call-1");
    expect(state.status === "described" && state.subject.title).toBe(
      "Accept a follow-up with Mara",
    );
  });

  it("tells the components reading that call, and only those", () => {
    let forOne = 0;
    let forAnother = 0;
    claimApprovalSubjectLookup("call-1");
    claimApprovalSubjectLookup("call-2");
    subscribeApprovalSubject("call-1", () => {
      forOne += 1;
    });
    const stop = subscribeApprovalSubject("call-2", () => {
      forAnother += 1;
    });

    settleApprovalSubject("call-1", APPROVAL_SUBJECT_MISSING);
    expect([forOne, forAnother]).toEqual([1, 0]);

    stop();
    settleApprovalSubject("call-2", APPROVAL_SUBJECT_MISSING);
    expect(forAnother).toBe(0);
  });
});

/**
 * The store deliberately outlives every component that reads it, so nothing else
 * would ever drop an entry. Without a bound, a tab left open all day accumulates one
 * owner-scoped answer per approval for as long as it stays open.
 */
describe("the cache's own bound", () => {
  it("forgets the oldest answers once it is full, and would read them again if asked", () => {
    fillPastTheBound();

    expect(readApprovalSubject("call-0").status).toBe("pending");
    expect(claimApprovalSubjectLookup("call-0")).toBe(true);

    const newest = readApprovalSubject(`call-${PAST_THE_BOUND - 1}`);
    expect(newest.status === "described" && newest.subject.title).toBe(
      `Record ${PAST_THE_BOUND - 1}`,
    );
  });

  it("drops an answer that lands after its own eviction", () => {
    // `evictStaleLookups` only ever walks `started`, so an entry written into
    // `states` for an id that is no longer there is one nothing could ever drop
    // again: the store would grow by one for every in-flight lookup that
    // outlived its own eviction, and a tab busy enough to evict is exactly the
    // tab whose reads settle late.
    claimApprovalSubjectLookup("call-slow");
    fillPastTheBound();
    // The control: the fill evicts, so `call-slow` is gone from `started` too.
    expect(readApprovalSubject("call-0").status).toBe("pending");

    settleApprovalSubject("call-slow", describedAs("Archive a memory about Ana"));

    expect(readApprovalSubject("call-slow").status).toBe("pending");
    // Forgotten completely rather than merely unread, which is what keeps every
    // remembered answer reachable by the eviction walk.
    expect(claimApprovalSubjectLookup("call-slow")).toBe(true);
  });

  it("keeps a late answer for a card that is back on screen, and tracks it again", () => {
    claimApprovalSubjectLookup("call-slow");
    fillPastTheBound();
    subscribeApprovalSubject("call-slow", () => {});

    settleApprovalSubject("call-slow", describedAs("Archive a memory about Ana"));

    const state = readApprovalSubject("call-slow");
    expect(state.status === "described" && state.subject.title).toBe("Archive a memory about Ana");
    // Back under the eviction walk: kept for the card on screen without becoming
    // an entry nothing can drop once that card is gone.
    expect(claimApprovalSubjectLookup("call-slow")).toBe(false);
  });

  it("never evicts a call a mounted card is still reading", () => {
    // Evicting this one would blank a card on screen and — having also forgotten it
    // was ever fetched — spend a second owner-scoped read filling it back in.
    claimApprovalSubjectLookup("call-onscreen");
    settleApprovalSubject("call-onscreen", describedAs("Archive a memory about Ana"));
    subscribeApprovalSubject("call-onscreen", () => {});

    fillPastTheBound();

    const state = readApprovalSubject("call-onscreen");
    expect(state.status === "described" && state.subject.title).toBe("Archive a memory about Ana");
    expect(claimApprovalSubjectLookup("call-onscreen")).toBe(false);
  });
});

/**
 * Sign-out calls this. A soft navigation to `/sign-in` tears down no JavaScript, so
 * without it one person's record titles would sit in memory for whoever signs in next
 * on the same device.
 */
describe("resetApprovalSubjectCache", () => {
  it("forgets every answer, every reader, and every claim", () => {
    let notified = 0;
    claimApprovalSubjectLookup("call-1");
    settleApprovalSubject("call-1", describedAs("Accept a follow-up with Mara"));
    subscribeApprovalSubject("call-1", () => {
      notified += 1;
    });

    resetApprovalSubjectCache();

    expect(readApprovalSubject("call-1").status).toBe("pending");
    expect(claimApprovalSubjectLookup("call-1")).toBe(true);
    settleApprovalSubject("call-1", describedAs("Accept a follow-up with Mara"));
    expect(notified).toBe(0);
  });
});
