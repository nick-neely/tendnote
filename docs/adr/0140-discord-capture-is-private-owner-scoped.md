# Discord Capture Is Private Owner-Scoped

Discord capture (#166–#169) always produces a private, owner-scoped Source Record for
the resolved Tendnote user. The enforcement of that guarantee is the DB capture path,
which hardcodes `scope: "private"` on every Source Record it writes; the shared
`captureSourceRecord` input deliberately exposes no scope parameter, so no surface —
Discord included — can widen scope through it. Household and shared visibility are Phase 4
scopes (`private`, `shared`, `household`; ADR-0132) that define visibility, not
authority, and they must come from an explicit in-product visibility choice — never
inferred from where a Discord message happened to originate.

At the Discord boundary, `resolveDiscordCaptureScope` runs before any write as a
fail-closed gate and a documented contract, not as the privacy enforcement itself. It
yields only `{ type: "private" }` (the write may proceed down the already-private DB
path) or a rejection; a `private` decision intentionally carries no scope payload, so the
seam cannot masquerade as enforcement it does not perform. This keeps the invariant honest
even if the shared capture input later gains a scope field: the gate would still refuse a
non-private Discord request, and the DB hardcode would still be the thing that makes the
write private.

Guild, channel, and bot-install membership are the exact signals a future author might
be tempted to read as household or shared authority, so the policy accepts them as
explicit inputs and deliberately ignores them: a Discord guild id is not unique to one
owner (ADR-0139), and shared guild/channel membership grants no household read or write
authority. The only non-private path the policy offers is a fail-closed rejection
(`household_scope_not_supported`): if a future surface ever plumbs an explicit non-private
`requestedScope` through a Discord interaction, capture is rejected rather than honored.
The live Discord wire cannot even express a non-private scope today, so this guard
protects a future programmatic seam, and the deterministic decision runs ahead of any
privacy-guard review (ADR-0137).

Because every Discord-captured record is private owner-scoped, it is invisible to other
household members through the shared scope model (`canViewScopedRecord`) and therefore
through every surface built on it — Eve answers, review surfaces, scheduled artifacts,
and Discord responses. Records that are genuinely `household`- or `shared`-scoped
(created through explicit in-product choices, never from Discord) keep their scope and
provenance and remain visible to active members through the same deterministic check, so
the boundary preserves scope in both directions.
