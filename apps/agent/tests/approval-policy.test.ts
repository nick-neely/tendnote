import type { ApprovalContext } from "eve/tools/approval";
import { describe, expect, it } from "vitest";
import {
  OPAQUE_DENIAL,
  type OwnerApprovalSpec,
  requireOwnerApproval,
  requireRestrictedRevealApproval,
} from "../agent/lib/approval";
import { toolApprovalContext } from "./test-tool";

const denied = { type: "denied", reason: OPAQUE_DENIAL };

/** Run a policy against one hand-rolled approval context. */
function run<TInput>(spec: OwnerApprovalSpec<TInput>, ctx: unknown): Promise<unknown> {
  return Promise.resolve(requireOwnerApproval<TInput>(spec)(ctx as ApprovalContext<TInput>));
}

describe("requireOwnerApproval: who may be asked", () => {
  it("parks an authenticated owner's web-chat turn for a decision", async () => {
    await expect(run({}, toolApprovalContext())).resolves.toBe("user-approval");
  });

  it("denies a turn with no authenticated principal at all", async () => {
    await expect(run({}, toolApprovalContext({ principal: null }))).resolves.toEqual(denied);
  });

  it("denies Eve's own runtime principal, which no human is watching", async () => {
    // A scheduled workflow runs as `eve:app`. Parking it would wait forever.
    await expect(
      run(
        {},
        toolApprovalContext({
          principal: {
            attributes: {},
            authenticator: "app",
            principalId: "eve:app",
            principalType: "runtime",
          },
        }),
      ),
    ).resolves.toEqual(denied);
  });

  it("denies a principal type that is neither a user nor recognised", async () => {
    await expect(
      run({}, toolApprovalContext({ principal: { principalType: "service" } })),
    ).resolves.toEqual(denied);
  });

  it("denies a blank principal id", async () => {
    await expect(
      run({}, toolApprovalContext({ principal: { principalId: "   " } })),
    ).resolves.toEqual(denied);
  });

  it("denies Discord capture, which cannot render or answer an approval", async () => {
    await expect(
      run({}, toolApprovalContext({ principal: { attributes: { channel: "discord" } } })),
    ).resolves.toEqual(denied);
  });

  it("denies a user principal with no channel marker, or an unrecognised one", async () => {
    await expect(run({}, toolApprovalContext({ principal: { attributes: {} } }))).resolves.toEqual(
      denied,
    );
    await expect(
      run({}, toolApprovalContext({ principal: { attributes: { channel: "whatsapp" } } })),
    ).resolves.toEqual(denied);
    // `attributes.channel` is `string | readonly string[]`; only a single marker counts.
    await expect(
      run({}, toolApprovalContext({ principal: { attributes: { channel: ["eve"] } } })),
    ).resolves.toEqual(denied);
  });

  it("denies a subagent turn: subagents propose, they do not write", async () => {
    await expect(run({}, toolApprovalContext({ subagent: true }))).resolves.toEqual(denied);
  });
});

describe("requireOwnerApproval: every call is its own decision", () => {
  it("ignores the session-wide approved-tools memory", async () => {
    // eve's `once()` keys off this set. A durable write is never approved by an
    // earlier, unrelated call to the same tool.
    await expect(
      run({}, toolApprovalContext({ approvedTools: ["web_fetch"], toolName: "web_fetch" })),
    ).resolves.toBe("user-approval");
  });
});

describe("requireOwnerApproval: the `when` predicate", () => {
  const gateOnFlag: OwnerApprovalSpec<{ includeRestricted?: boolean }> = {
    when: (input) => input?.includeRestricted === true,
  };

  it("is not applicable when the predicate is false", async () => {
    await expect(
      run(gateOnFlag, toolApprovalContext({ toolInput: { includeRestricted: false } })),
    ).resolves.toBe("not-applicable");
  });

  it("parks when the predicate is true", async () => {
    await expect(
      run(gateOnFlag, toolApprovalContext({ toolInput: { includeRestricted: true } })),
    ).resolves.toBe("user-approval");
  });

  it("runs before the principal check, so an ungated call is never denied", async () => {
    // A scheduled workflow may still call a flag-style tool with the flag unset:
    // that call asks for nothing extra, so it is not this gate's business.
    await expect(
      run(
        gateOnFlag,
        toolApprovalContext({
          principal: { principalType: "runtime", principalId: "eve:app" },
          toolInput: { includeRestricted: false },
        }),
      ),
    ).resolves.toBe("not-applicable");
  });

  it("treats a missing tool input as ungated when the predicate says so", async () => {
    await expect(run(gateOnFlag, toolApprovalContext({ toolInput: undefined }))).resolves.toBe(
      "not-applicable",
    );
  });
});

/**
 * Eight tools offer the same restricted-reveal request under two spellings, and
 * each used to write the predicate out again. These are the cases a hand-copied
 * ninth copy would get wrong.
 */
describe("requireRestrictedRevealApproval: the one predicate both spellings share", () => {
  const policy = requireRestrictedRevealApproval<Record<string, unknown>>();
  const decide = (toolInput: Record<string, unknown> | undefined) =>
    Promise.resolve(policy(toolApprovalContext({ toolInput }) as ApprovalContext<never>));

  it.each([{ includeRestricted: true }, { directlyRequested: true }])(
    "parks a call that asks with %s",
    async (toolInput) => {
      await expect(decide(toolInput)).resolves.toBe("user-approval");
    },
  );

  it.each([
    ["unset", {}],
    ["explicitly false", { includeRestricted: false, directlyRequested: false }],
    ["absent entirely", undefined],
  ])("leaves an ordinary call alone when the request is %s", async (_name, toolInput) => {
    await expect(decide(toolInput)).resolves.toBe("not-applicable");
  });

  it.each([
    ["the string 'true'", { includeRestricted: "true" }],
    ["a truthy number", { directlyRequested: 1 }],
    ["a neighbouring argument", { includeArchived: true, includeReviewGated: true }],
  ])("does not treat %s as a request", async (_name, toolInput) => {
    // Strictly `=== true` on strictly those two keys: a provider that stringifies
    // booleans must not be able to widen anything by being merely truthy, and an
    // unrelated `include*` argument is not this gate's business.
    await expect(decide(toolInput)).resolves.toBe("not-applicable");
  });
});

describe("requireOwnerApproval: owner-scoped subject resolution", () => {
  const withSubject = (found: boolean): OwnerApprovalSpec<{ id: string }> => ({
    describe: () => ({ found }),
  });

  it("parks when the record resolved inside the owner's scope", async () => {
    await expect(
      run(withSubject(true), toolApprovalContext({ toolInput: { id: "r1" } })),
    ).resolves.toBe("user-approval");
  });

  it("denies opaquely when the record is not the owner's", async () => {
    // ADR-0219: a caller learns nothing about a record it may not touch.
    await expect(
      run(withSubject(false), toolApprovalContext({ toolInput: { id: "r1" } })),
    ).resolves.toEqual(denied);
  });

  it("hands the resolver the owner id and the call identity", async () => {
    const seen: unknown[] = [];
    await run<{ id: string }>(
      {
        describe: (input, ctx) => {
          seen.push({ input, ...ctx });
          return { found: true };
        },
      },
      toolApprovalContext({ toolInput: { id: "r1" }, toolName: "edit_asset", callId: "call-9" }),
    );

    expect(seen).toEqual([
      {
        input: { id: "r1" },
        ownerUserId: "user-1",
        toolName: "edit_asset",
        callId: "call-9",
      },
    ]);
  });

  it("awaits an async resolver", async () => {
    await expect(
      run<{ id: string }>(
        { describe: async () => ({ found: true }) },
        toolApprovalContext({ toolInput: { id: "r1" } }),
      ),
    ).resolves.toBe("user-approval");
  });

  it("does not resolve a record for a caller who could never be asked", async () => {
    let calls = 0;
    await run<{ id: string }>(
      {
        describe: () => {
          calls += 1;
          return { found: true };
        },
      },
      toolApprovalContext({ principal: null, toolInput: { id: "r1" } }),
    );

    expect(calls).toBe(0);
  });
});

describe("requireOwnerApproval: it never throws", () => {
  // eve runs the policy inside its approval callback; a throw there aborts the
  // turn rather than failing closed, so every path has to return a status.
  it("denies when the predicate throws", async () => {
    await expect(
      run(
        {
          when: () => {
            throw new Error("boom");
          },
        },
        toolApprovalContext(),
      ),
    ).resolves.toEqual(denied);
  });

  it("denies when the subject resolver throws", async () => {
    await expect(
      run(
        {
          describe: () => {
            throw new Error("store unreachable");
          },
        },
        toolApprovalContext(),
      ),
    ).resolves.toEqual(denied);
  });

  it("denies when the subject resolver rejects", async () => {
    await expect(
      run({ describe: () => Promise.reject(new Error("timeout")) }, toolApprovalContext()),
    ).resolves.toEqual(denied);
  });

  it("denies a context that is missing the session entirely", async () => {
    await expect(run({}, {})).resolves.toEqual(denied);
    await expect(run({}, undefined)).resolves.toEqual(denied);
    await expect(run({}, { session: {} })).resolves.toEqual(denied);
    await expect(run({}, { session: { auth: {} } })).resolves.toEqual(denied);
  });
});

describe("requireOwnerApproval: the denial reason is uniform", () => {
  it("says the same opaque thing for every cause", async () => {
    const causes = [
      toolApprovalContext({ principal: null }),
      toolApprovalContext({ principal: { principalType: "runtime" } }),
      toolApprovalContext({ principal: { attributes: { channel: "discord" } } }),
      toolApprovalContext({ subagent: true }),
    ];

    for (const ctx of causes) {
      await expect(run({}, ctx)).resolves.toEqual(denied);
    }

    await expect(
      run({ describe: () => ({ found: false }) }, toolApprovalContext()),
    ).resolves.toEqual(denied);
  });

  it("tells the model not to retry, rephrase, or claim success", () => {
    expect(OPAQUE_DENIAL).toMatch(/do not retry/i);
    expect(OPAQUE_DENIAL).toMatch(/rephrase/i);
    expect(OPAQUE_DENIAL).toMatch(/done|success/i);
    // And it names no record, owner, or cause.
    expect(OPAQUE_DENIAL).not.toMatch(/subagent|discord|schedul|principal|owner of/i);
  });
});
