# Eve's Interactive Tool Surface Uses Progressive Disclosure

ADR 0128 modes only ever restrict, and `web_chat` deliberately restricts
nothing: its entry in the mode table is `EVE_GATED_TOOL_NAMES`, the whole
authored tool set, with the comment recording that narrowing happens elsewhere
and never there. The consequence is that mode narrowing reduces cost on the
unattended paths and not on the interactive one.

Measured on the current agent summary, the fixed per-turn overhead is roughly
17.7k tokens: about 3.4k of instructions and about 12.7k across 65 tool
schemas. The schemas are therefore roughly 72% of the fixed cost of every
interactive turn, before conversation history, retrieved context, or tool
results.

The instruction side is already well designed for this. Skills do not ship in
the base prompt; they load on demand when the model calls `load_skill`. The
tool side has no equivalent.

## Decision

The interactive surface adopts **progressive tool disclosure**, mirroring the
existing skill-loading pattern. A small router surface is offered by default
and a tool family is disclosed on demand, rather than every authored tool
shipping its schema on every turn.

**This is a cost and latency mechanism, never an authority mechanism.** ADR
0128's mode gate remains the security boundary, and the two must not be
conflated: withholding a schema to save tokens is not withholding a capability
to enforce policy. The gate must continue to fail closed, and a tool that a
mode forbids must remain unreachable whether or not disclosure has offered it.

The work is sequenced ahead of model selection. The reduction is
model-independent, so it compounds with whatever model is later chosen and
makes each model comparison cheaper to run.

Model selection additionally requires that **the eval suite has executed at
least once**. The instruction set encodes trust tiers, approval gates, and
egress rules in prose, and a cheaper model may follow subtle prose less
reliably. Without an executed suite there is no measurement of the property
that would hurt most if a model swap degraded it.

## Consequences

A turn that needs an undisclosed tool family costs an extra round trip. That is
accepted against roughly halving the fixed input cost of every turn.

Disclosure introduces a second surface that can drift from the mode table. The
two must be tested together, and a tool added to `agent/tools/` must not become
reachable in a mode that forbids it merely because disclosure offered it.

The eval suite acquires a commercial justification in addition to its safety
one. It is a prerequisite for the model decision that sets the hosted price,
which is a stronger and more concrete reason to fund a run than correctness
hygiene alone.

## Evidence

Every authored tool now sits in at least one Tool Family (#598, #599). A family
holds exactly the tools its skill documents, so a tool several skills use, such
as `search_people`, is disclosed by any one of them. `suggest_next_steps` and
`web_fetch` are documented only in the base instructions, so every family
discloses them. Before any skill loads, the interactive surface ships the
framework tools (`todo`, `load_skill`, `ask_question`, `web_search`) and a
schema-less stub per authored tool. The stub names the skills that disclose it.
`apps/agent/tests/eve-tool-disclosure.test.ts` pins both rules against the
skill files.

**Method.** The estimate is serialized JSON length divided by four, the same
estimator eve 0.47.7 uses for compaction. It runs over the compiled manifest's
name, description, and input schema for each tool, the stubs the disclosure
resolver actually returns, the instructions, and the available-skills block.
Dynamic per-turn instructions (date, approval posture, Self Context) are left
out. Measured on 2026-09-27 against `f4a1097d` plus this change.

**Baseline check.** On the pre-disclosure surface this method gives about
39.8k tokens. The provider reported 39,885 input tokens for the first
interactive call of the light replay
(`evidence/cost/c3bca6da4f87d945c8f3bbc9921aa0ac32482034/ledger.json`), so the
method tracks real Gemini 3.7 Flash counts closely. The 17.7k figure recorded
above undercounted: the tool schemas alone were about 32.7k, not 12.7k.

| Surface on a default interactive turn | Authored tool definitions | Fixed overhead |
| --- | ---: | ---: |
| Before disclosure (every schema) | ~32.7k | ~39.8k |
| First families (#598, 28 tools stubbed) | ~20.9k | ~28.0k |
| Every family (#599, 67 tools stubbed) | ~4.1k | ~11.2k |

The ~11.2k is about 5.9k of instructions and the skills block, 4.1k of stubs,
0.8k of framework tools, and 0.4k of subagent descriptors. Compared with the
same-method baseline, that is a reduction of about 72%.

A loaded skill adds its family's schemas for the rest of the conversation.
These are net of the stubs they replace, and families overlap, so they do not
sum:

| Family | Tools | Added when disclosed |
| --- | ---: | ---: |
| `recall` | 18 | ~11.3k |
| `actions` | 22 | ~10.8k |
| `capturing-and-review` | 19 | ~7.2k |
| `drafting` | 8 | ~3.7k |
| `self-context` | 9 | ~3.7k |
| `followups` | 12 | ~3.5k |
| `household-and-gifts` | 8 | ~2.3k |

These are estimates, not billed tokens. The paid confirmation belongs to the
model qualification gate: the policy-tagged Eve evals and the Representative
Month replay, both on this surface.
