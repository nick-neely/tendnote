# Phase Seven Personal OS verification

This is the release evidence index for specification #264 and proof ticket #275. The durable
behavioral contract remains `docs/prd.md`; this file names the executable proof and keeps physical
device observations separate from simulated or provider-acceptance evidence.

## Automated evidence

| Contract | Primary evidence |
| --- | --- |
| One grounded refrigerator-filter Capture produces only the explicit Action and open question while the inferred Asset fact remains review-gated | `packages/db/src/queries/phase-7-personal-os-e2e.test.ts`, `packages/db/src/queries/capture/conversational-capture-cross-domain.test.ts`, `packages/domain/src/conversational-capture-routing.test.ts` |
| The accepted Asset Memory, linked Action, private Saved Item, Today resurfacing, Reminder Schedule, push retry, Search, and Eve-facing Global Recall stay coherent through shared owner-scoped product functions | `packages/db/src/queries/phase-7-personal-os-e2e.test.ts` |
| One-week alert scope is limited to the explicitly alerted Action; the first eligible save precedes earned opt-in; preview is generic; deep links re-authorize without mutation | `packages/db/src/queries/reminders/capture-reminders.test.ts`, `packages/db/src/queries/reminders/*.test.ts`, `apps/web/src/app/reminders/open/route.test.ts` |
| Today explanations, caps, feedback-only suppression, and deterministic fallback survive Eve failure without changing backing records | `packages/db/src/queries/today/*.test.ts`, `packages/domain/src/today.test.ts`, `packages/db/src/queries/phase-7-personal-os-e2e.test.ts` |
| Exact precedes Related, canonical links and citations remain grounded, weak capabilities report limitations, and inaccessible records do not leak | `packages/db/src/queries/global-recall/*.test.ts`, `apps/agent/tests/global-recall-tool.test.ts`, `packages/db/src/queries/phase-7-personal-os-e2e.test.ts` |
| Eve stays factual and refuses invented writes, scope, priority, or alerts | `apps/agent/evals/**/*phase-seven*.eval.ts` plus every eval tagged `phase-seven` |
| Primary phone navigation and focused Today, Search, Capture, and Reminder Opt-In flows remain named, focus-safe, 44-by-44, horizontally contained at 390 by 844, and usable at 200% text | `apps/web/src/components/phase-seven-mobile.browser.test.tsx`, `apps/web/src/components/action-mobile-contracts.browser.test.tsx`, and the focused DOM accessibility suites |
| Offline drafts, safe updates, honest failure states, sign-out, revocation, stale suppression, and unsupported reminder contexts preserve their trust boundaries | `apps/web/src/lib/pwa-contract.test.ts`, `apps/web/src/components/mobile-*.test.tsx`, `apps/web/src/components/reminder-*.test.tsx`, and `packages/db/src/queries/reminders/*.test.ts` |

The final repository gate is:

```text
pnpm verify
pnpm db:check
pnpm --filter @tendnote/web test:browser
pnpm --filter @tendnote/agent eval:deterministic
pnpm coverage:ci
pnpm fallow:coverage:check
pnpm fallow:ci
git diff --check
```

When an Eve dev server is already running against the normal development database, run evals
against a separate temporary Eve instance connected to `tendnote_eval`; never reuse the normal
server for mutation-capable evals.

## Physical device release record

Physical operating-system display cannot be inferred from Chromium emulation or push-provider
acceptance. Before a production release, record the deployed build, device/browser versions,
tester, date, and pass/fail notes for each row below.

- Candidate: `d44abc4`, Vercel preview deployment `dpl_HPRTstVhvEA2td8ryQKenPXAzqkn`.
- Tester/date: Nick Neely, 2026-07-22. The tester confirmed the current supported device/browser
  matrix passed; exact OS and browser build identifiers were not supplied in the acceptance note.

- [x] Current supported iOS Safari: sign-in; Today; Search; Capture; Review; Eve; offline failure;
      24-hour draft lifecycle; update prompt; installation guidance; unsupported push context. Pass.
- [x] Current supported iOS Home Screen PWA: earned opt-in; permission timing; generic and detailed
      previews; authenticated deep link; disable/re-enable; revocation; stale suppression; safe
      update with an active draft. Pass.
- [x] Current supported Android browser and installed PWA: core flows without mandatory install;
      earned opt-in; permission timing; generic and detailed previews; multi-installation fan-out;
      endpoint replacement or terminal failure; revocation; stale suppression. Pass.
- [x] Cross-device observation: one installation's retry or revocation does not affect another,
      and no provider-accepted request is recorded as proof that the operating system displayed it.
      Pass.

An unchecked row is an explicit release gate, not a claimed pass and not evidence that repository
behavior was skipped.
