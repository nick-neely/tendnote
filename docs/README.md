# Tendnote documentation

This landing page is the short map of the repository's durable documentation.
For the technical build story, use the [Canonical Case Study in the immutable
reviewed-content bundle](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/case-studies/tendnote-agent-built-privacy.md)
first. It is the citable source for the bounded claim, decision record, exact
evaluation evidence, and preserved history. The exact qualified
integration/publication commit is reserved for #488 after qualification.

## Build and operate

- [Architecture](architecture.md) — system seams, ownership, and runtime boundaries.
- [Local development](local-development.md) — setup, environment variables, evals, and verification.
- [Self-hosting](self-hosting/vercel-operator-runbook.md) — the operator-owned Vercel path.
- [Background jobs](background-job-delivery.md) — queue and outbox mechanics.
- [Email setup](email-setup.md), [Google setup](google-setup.md), and [Discord setup](discord-setup.md) — opt-in provider configuration.

## Trust and contribution

- [Security and privacy](security.md) — deterministic controls, limits, and operator responsibilities.
- [Community support](support.md) — the no-SLA, community-only support boundary.
- [Contributing](contributing.md) — contribution agreements, AI assistance, and public-reporting boundaries.
- [CI contribution notes](ci-contributing.md) — verification labels and workflow expectations.
- [Legal and contribution agreements](legal/README.md) — the effective agreement packet and acceptance path.

## Decisions

The [ADR catalog](adr/README.md) groups the numbered architecture decision
records by topic and phase. Existing ADR filenames and numbers are stable;
the catalog is only a navigation aid.

The product roadmap and Phase 9a working material remain planning records, not
part of the newcomer evidence path. Start with the Case Study when you want
the public build story.
