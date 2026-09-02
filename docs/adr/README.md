# Architecture decision records

The ADRs are the repository's numbered decision record. Their filenames and
numbers are stable; this page is only a catalog, not a replacement, rewrite,
or renumbering of an existing record. Read the [Canonical Case
Study](../case-studies/tendnote-agent-built-privacy.md) first when you want
the bounded publication evidence path.

## Trust, ownership, and evidence

- [0001 — Shared owner-scoped mutations](0001-shared-owner-scoped-mutations.md)
- [0004 — Context trust policy](0004-context-trust-policy.md)
- [0005 — Source records as evidence layer](0005-source-records-as-evidence-layer.md)
- [0014 — Lifecycle fields plus audit for approval](0014-lifecycle-fields-plus-audit-for-approval.md)
- [0020 — Deterministic extraction before LLM](0020-deterministic-extraction-before-llm.md)
- [0021 — Explicit memory capture keeps source record](0021-explicit-memory-capture-keeps-source-record.md)
- [0022 — Memory writes require source records](0022-memory-writes-require-source-records.md)
- [0054 — Sensitivity and scope are distinct](0054-sensitivity-and-scope-are-distinct.md)
- [0055 — Reserve shared scopes but block writes](0055-reserve-shared-scopes-but-block-writes.md)
- [0056 — Manual sensitivity override wins](0056-manual-sensitivity-override-wins.md)
- [0057 — Restricted sensitivity is not private](0057-restricted-sensitivity-not-private.md)
- [0058 — Restricted content is not proactive](0058-restricted-content-is-not-proactive.md)
- [0137 — Privacy Guard reviews after deterministic scope](0137-privacy-guard-reviews-after-deterministic-scope.md)
- [0192 — Asset audit is internal first](0192-asset-audit-is-internal-first.md)
- [0223 — Audit log retention is internal, bounded, and hard-deleted](0223-audit-log-retention-and-internal-read-boundary.md)

## Agent, capture, and review

- [0025 — Review loop before dashboard](0025-review-loop-before-dashboard.md)
- [0026 — Conversational review surface](0026-conversational-review-surface.md)
- [0027 — Fixed typed assistant components](0027-fixed-typed-assistant-components.md)
- [0028 — Assistant components reference records](0028-assistant-components-reference-records.md)
- [0029 — Conversation is not source of truth](0029-conversation-is-not-source-of-truth.md)
- [0033 — Person creation requires intent](0033-person-creation-requires-intent.md)
- [0040 — Drafting after review loop](0040-drafting-after-review-loop.md)
- [0041 — Separate memory and follow-up suggestion rules](0041-separate-memory-and-followup-suggestion-rules.md)
- [0123 — Memory Curator is review only](0123-memory-curator-is-review-only.md)
- [0125 — Message Drafter proposes before persisting](0125-message-drafter-proposes-before-persisting.md)
- [0144 — General Action creation is direct or review-gated](0144-general-action-creation-is-direct-or-review-gated.md)
- [0159 — Eve mutates General Actions only on explicit instruction](0159-eve-mutates-general-actions-only-on-explicit-instruction.md)
- [0195 — Agent-backed surfaces use shared typed capabilities](0195-agent-backed-surfaces-use-shared-typed-capabilities.md)
- [0197 — Conversational Capture separates explicit and inferred authority](0197-conversational-capture-separates-explicit-and-inferred-authority.md)
- [0237 — Eve tool arguments are requests, not proofs](0237-eve-tool-arguments-are-requests-not-proofs.md)
- [0238 — Assistant conversations are Tendnote threads over Eve sessions](0238-assistant-conversations-are-tendnote-threads-over-eve-sessions.md)

## Product phases

| Phase | Representative decisions |
| --- | --- |
| Foundation and relationships | [0015](0015-source-records-and-memory-first.md), [0031](0031-global-assistant-with-context.md), [0042](0042-manual-followups-before-suggested-followups.md), [0059](0059-policy-tests-before-model-evals.md) |
| Phase 2 integrations | [0061](0061-web-chat-streams-eve-same-origin.md), [0067](0067-private-beta-access-uses-vercel-flags.md), [0083](0083-gmail-drafts-externalize-approved-tendnote-drafts.md), [0092](0092-eve-gmail-writes-use-shared-approval-gate.md), [0101](0101-google-contacts-import-is-explicit-preview-first.md), [0122](0122-discord-first-private-capture-channel.md) |
| Phase 4 Household | [0130](0130-household-workspace-is-the-phase-4-permission-anchor.md), [0131](0131-phase-4-household-roles-are-owner-and-member.md), [0132](0132-household-scopes-define-visibility-not-authority.md), [0137](0137-privacy-guard-reviews-after-deterministic-scope.md), [0213](0213-household-governance-protects-co-owners-and-separates-invitations.md), [0219](0219-household-authorization-proofs-guard-cross-domain-collaboration.md) |
| Phase 5 Actions | [0143](0143-general-actions-are-separate-from-followups.md), [0145](0145-general-actions-start-with-a-bounded-personal-os-action-model.md), [0146](0146-general-action-areas-are-custom-and-flat.md), [0150](0150-phase-5-general-actions-are-eve-and-retrieval-first.md), [0166](0166-phase-5-excludes-project-management-and-external-action-systems.md) |
| Phase 6 Assets | [0168](0168-assets-can-start-as-lightweight-anchors.md), [0169](0169-asset-extraction-is-review-gated.md), [0171](0171-phase-6-assets-use-evidence-not-document-management.md), [0179](0179-asset-scope-is-a-ceiling-for-child-records.md), [0193](0193-phase-6-includes-asset-eve-evals-and-policy-tests.md) |
| Phase 7 and runtime | [0198](0198-phase-7-pwa-is-online-required.md), [0199](0199-global-recall-unifies-eve-and-structured-search.md), [0205](0205-authenticated-shell-follows-admission.md), [0206](0206-authenticated-routes-use-scoped-cache-and-stream-contracts.md), [0209](0209-optimism-is-reversible-and-server-reconciled.md), [0210](0210-instant-navigation-gates-are-tiered-by-signal-and-cost.md) |
| Phase 8 Household expansion | [0212](0212-context-facts-are-a-distinct-shared-subject-domain.md), [0214](0214-household-native-records-are-owned-by-the-workspace.md), [0218](0218-household-relationship-sharing-does-not-create-shared-people.md), [0220](0220-household-aware-assistance-is-caller-scoped-and-member-delivered.md), [0221](0221-household-erasure-closes-the-recovery-window-it-opens.md), [0231](0231-owner-data-export-is-owner-scoped-and-portable.md) |

## Publication and operating boundaries

- [0224 — Tendnote publishes as AGPL-3.0 open core](0224-tendnote-publishes-as-agpl-open-core.md)
- [0225 — Self-hosting is scoped to the operator's own Vercel deployment](0225-self-hosting-is-scoped-to-the-operators-own-vercel-deployment.md)
- [0227 — Eve's interactive tool surface uses progressive disclosure](0227-eve-interactive-tool-surface-uses-progressive-disclosure.md)
- [0228 — Publication precedes commercialization](0228-publication-precedes-commercialization.md)
- [0229 — Publication preserves the complete git history](0229-publication-preserves-the-complete-git-history.md)
- [0230 — Case Study keeps evidence canonical and presentation separate](0230-case-study-keeps-evidence-canonical-and-presentation-separate.md)
- [0231 — Owner Data Export is owner-scoped and portable](0231-owner-data-export-is-owner-scoped-and-portable.md)
- [0232 — Self-hosted admission is explicit and Household-bounded](0232-self-hosted-admission-is-explicit-and-household-bounded.md)
- [0233 — Contributions use an individual CLA and PR-local provenance](0233-contributions-use-an-individual-cla-and-pr-local-provenance.md)
- [0234 — Reader Evidence Path starts at the README](0234-reader-evidence-path-starts-at-the-readme.md)
- [0235 — Self-hosted admission uses an explicit email policy](0235-self-hosted-admission-uses-an-explicit-email-policy.md)
- [0236 - Pull request verification is one full-fidelity path](0236-pull-request-verification-is-one-full-fidelity-path.md)

The catalog intentionally omits the Phase 9a planning workspace. That
workspace remains useful to maintainers, but it is not a newcomer evidence
route.
