# Self-Hosted Admission Is Explicit And Household-Bounded

ADR 0225 makes an operator's own Vercel deployment the supported self-hosting
shape, but its admission policy remained unspecified. Treating a missing
Vercel Flags configuration as a signal to open access would turn a hosted
misconfiguration into a security failure; requiring every self-hoster to
recreate the managed private-beta control would leave a normal deployment
unusable.

## Decision

A supported self-hosted deployment declares an explicit, documented
self-hosted admission mode. Production otherwise remains hosted by default:
hosted access continues to use Private Beta Access and fails closed when its
Flags evaluation is unavailable. The application must never infer self-hosted
mode from a missing provider configuration, Vercel account, hostname, or
deployment failure.

Self-hosted mode requires a configured bootstrap-owner identity. Only that
authenticated identity may establish the initial product owner; a first signup
does not win by arrival order. Later ordinary signups remain pending. A
recipient who proves a live Household invitation and the invited email is
admitted durably as part of accepting that invitation, without an additional
operator grant. The mode therefore supports one initial owner and their
invited Household Members, not arbitrary unrelated accounts or a multi-tenant
hosted service.

## Consequences

Self-hosting documentation must name the explicit mode, bootstrap-owner
configuration, invitation path, and its community-only support boundary. An
invalid or incomplete self-hosted configuration fails closed rather than
falling back to arrival-order bootstrap or open signup. The web and Eve
boundaries must apply the same durable admission decision. Supporting multiple
independent owners on one self-hosted deployment is a separate future decision.
