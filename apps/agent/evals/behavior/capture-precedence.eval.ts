import { defineEval } from "../define-eval";
import {
  hasCapturePersonClarification,
  hasNoRuntimeFailures,
  isPrivateOrOmitted,
} from "../expectations";

/**
 * Global Capture precedence, as one table.
 *
 * These were six separate files asserting the same three things about six
 * different sentences: the turn went through `capture_saved_item`, it went
 * through it exactly once, and none of the destination-specific tools that
 * each clause would otherwise reach for ran beside it. Six copies of one
 * assertion shape drift - and they had, into six different opinions about
 * which forbidden tools were worth naming. The variation that matters is the
 * sentence and the tools it tempts, so that is all that varies here.
 *
 * `count: 1` is the tool's own contract ("call this tool exactly once"), and it
 * is the half a per-file copy kept dropping: a turn that captures twice has
 * split one user request into two Saved Items, which is the failure grouping
 * exists to prevent. Matching defaults to completed calls, so a rejected call
 * the model retried does not trip it.
 */
type CapturePrecedenceCase = {
  /** Eval description, and the claim the case is making. */
  readonly claim: string;
  readonly tags: readonly string[];
  readonly prompt: string;
  /** The wording Capture must retain as source evidence. */
  readonly originalText: RegExp;
  /** Additional Capture input invariants for this case. */
  readonly captureInput?: Record<string, unknown>;
  /** Whether the grouped source must stay reviewable behind Person clarification. */
  readonly expectsPersonClarification?: boolean;
  /**
   * The destination-specific tools this sentence tempts. Every one is a tool
   * that exists and could serve a clause in the prompt: a ban on an unreachable
   * tool proves nothing.
   */
  readonly forbidden: readonly string[];
};

const cases: readonly CapturePrecedenceCase[] = [
  {
    claim:
      "Explicit Add Person intent goes through source-grounded Capture, not a side-channel write.",
    tags: ["deterministic", "behavior", "capture", "people", "phase-seven"],
    prompt: "Use Capture to add Priya.",
    originalText: /add Priya/i,
    forbidden: ["create_person"],
  },
  {
    claim: "A named-person reminder uses Capture and never creates a Person by mention alone.",
    tags: ["deterministic", "behavior", "capture", "people", "clarification", "phase-seven"],
    prompt: "Use Capture: remind me to follow up with Sam tomorrow.",
    originalText: /follow up with Sam/i,
    expectsPersonClarification: true,
    forbidden: ["create_person"],
  },
  {
    claim: "Explicit Memory and Asset facts enter their approved and review-gated Capture seams.",
    tags: ["deterministic", "behavior", "capture", "memory", "assets", "phase-seven"],
    // Keep this person deliberately absent from the committed fixture. Case 0000
    // adds Priya through Capture, and Eve's serial suite shares one freshly seeded
    // database across cases; reusing Priya here made this clarification assertion
    // depend on whether that earlier mutation had already run.
    prompt:
      "Use Capture: remember that Talia prefers oat milk; track asset refrigerator filter: model EDR4RXD1.",
    originalText: /remember.*track asset/is,
    captureInput: {
      inferredSuggestions: (value: unknown) => value === undefined,
      requestedScope: isPrivateOrOmitted,
    },
    expectsPersonClarification: true,
    forbidden: ["capture_memory", "create_asset"],
  },
  {
    claim:
      "Independently explicit cross-domain clauses use one grouped Capture without side-channel writes.",
    tags: ["deterministic", "behavior", "capture", "phase-seven"],
    prompt:
      "Add Priya; remember that Priya prefers oat milk; and track asset refrigerator water filter: model EDR4RXD1.",
    originalText: /Add Priya.*remember.*track asset/is,
    captureInput: { inferredSuggestions: (value: unknown) => value === undefined },
    forbidden: ["create_person", "capture_memory", "create_asset"],
  },
  {
    claim:
      "An explicit Global Capture self-fact uses the shared Capture entry point rather than the direct Self Context write.",
    tags: ["deterministic", "behavior", "self-context", "capture", "phase-seven-point-five"],
    prompt: "Use Capture to save this about me: I run a small software consultancy.",
    originalText: /I run a small software consultancy/i,
    forbidden: ["remember_self_context", "capture_memory"],
  },
  {
    claim: "An explicit Action does not lend durable authority to a merely inferred Memory.",
    tags: ["deterministic", "policy", "capture", "review-gate", "phase-seven"],
    prompt:
      "Use Capture to save this: I need to buy oat milk. Priya may prefer it, but I am not asking you to remember that.",
    originalText: /buy oat milk/i,
    forbidden: ["capture_memory", "create_person"],
  },
];

export default cases.map((testCase) =>
  defineEval({
    description: testCase.claim,
    tags: testCase.tags,
    async test(t) {
      await t.send(testCase.prompt);

      if (testCase.expectsPersonClarification) {
        // A focused Person clarification deliberately parks for owner input. Eve's
        // generic `succeeded` assertion rejects that healthy waiting state, so this
        // case proves the exact call, clarification result, and failure-free stream
        // directly instead.
        t.eventsSatisfy("the clarification parked without a runtime failure", hasNoRuntimeFailures);
      } else {
        t.succeeded();
      }
      t.calledTool("capture_saved_item", {
        input: {
          originalText: testCase.originalText,
          // Capture is private by default. None of these sentences says the capture is
          // for the household, so none of them may carry the audience field - the
          // positive case lives in `policy/capture-shared-audience`.
          requestedScope: isPrivateOrOmitted,
          ...testCase.captureInput,
        },
        count: 1,
      });
      for (const tool of testCase.forbidden) {
        t.notCalledTool(tool).label(`capture owns the turn, not ${tool}`);
      }
      if (testCase.expectsPersonClarification) {
        t.eventsSatisfy("the unresolved Person stays in Capture clarification", (events) =>
          hasCapturePersonClarification(events),
        );
      }
    },
  }),
);
