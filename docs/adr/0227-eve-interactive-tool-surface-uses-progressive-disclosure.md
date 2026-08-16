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
