# Self-Hosted Admission Uses An Explicit Email Policy

ADR 0232 establishes that an operator's Vercel deployment is household-bounded,
but a claim that a worked deployment path functions needs a configuration and
proof contract rather than an arrival-order bootstrap hidden in application
state. Treating absent Flags configuration as self-hosting would turn a hosted
misconfiguration into an admission failure; accepting an internal user id
would require an operator to discover a user that cannot exist until after
their first sign-in.

## Decision

Production admission reads one server-only policy before choosing an admission
resolver. `TENDNOTE_ADMISSION_MODE` accepts only `hosted` or `self-hosted` and
defaults to `hosted` when absent. Hosted mode retains Private Beta Access and
its Flags failure-closed behavior. `self-hosted` requires exactly one valid
`TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL`; the configured address is
normalized with the same comparison rule used for Household Invitations, and
matches the authenticated Better Auth session email. It never accepts a
first-arrival winner, a mutable internal user id, a hostname, a Vercel account,
or unavailable Flags configuration as an identity or mode signal.

The server-only policy loader validates the mode and email before it composes an
admission resolver. A missing or malformed self-hosted value produces an
explicit invalid-configuration policy: it records an operator-actionable safe
diagnostic and admits no account. Individual visitors receive the ordinary
pending treatment, not an explanation that reveals deployment configuration.
The configured owner receives one durable grant with source
`self_hosted_bootstrap`; accepting a live, email-matching Household Invitation
receives a separate durable `household_invitation` source. An ordinary later
signup remains pending.

The implementation is not ready for a worked deployment guide until hermetic
automated proof covers configuration parsing, the configured bootstrap owner,
an unrelated later account, concurrent first visits, and the atomic
email-matching invitation-acceptance grant. The proof must show both Web and
Eve enforce the same persisted Access Decision, including pending treatment
for invalid self-hosted configuration and unavailable hosted Flags. Tests may
use controlled credentials and local stores; they must not require an
operator's live Vercel project, Neon, Redis, OAuth application, mail sender, or
model credentials.

The future Vercel-only guide may name those operator-owned prerequisites and
the exact non-secret admission variables with synthetic values, linking to
provider setup where helpful. It may not publish accounts, secrets, or live
values; imply a deploy button or platform-neutral path; or promise that an
unlisted provider combination is supported.
