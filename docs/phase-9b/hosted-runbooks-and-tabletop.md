# Hosted runbooks and the pre-launch tabletop

Decision artifact for [Define the hosted incident, data-request, and
deletion-notice runbooks and the pre-launch
tabletop](https://github.com/nick-neely/tendnote/issues/582). It fixes the
procedures one author must be able to follow alone before the first paid
customer: the incident runbook, request handling at the support address, the
deletion-notice sequence before the ninety-day Lapsed purge, the Operator
Action runbooks and Service Notice procedure handed over by
[Bounded usage and the author-operated support contract](bounded-usage-and-support-contract.md),
and the one tabletop that proves the incident runbook. It builds on
[Hosted privacy and customer-lifecycle obligations](hosted-privacy-and-customer-lifecycle-obligations.md)
and [Hosted telemetry and its data boundary](hosted-telemetry-and-data-boundary.md).

It decides the shape and the binding rules of each procedure. The step-by-step
runbook text is written during implementation against the built system, in
the template below.

## Scope

- In: the incident runbook, request handling, the deletion-notice sequence,
  every Operator Action runbook, the Service Notice procedure, and the
  tabletop.
- Moved: the restore drill belongs to
  [The Backup Window and the deletion tail](backup-window-and-deletion-tail.md),
  because a drill is only meaningful against the backup design it proves.

## Where runbooks live

Procedures are public, in the AGPL repository under `docs/operations/`. None
of them is secret, and self-hosters can reuse them. One private operations
sheet, outside the repository, holds what is: provider account ids, contact
routes, credential locations, and counsel's contact. Runbooks reference the
sheet by entry name and never copy from it.

## One runbook template

Every runbook, including every Operator Action, has the same sections:

| Section | Holds |
| --- | --- |
| Trigger | The event or request that starts it |
| Preconditions | What must be true or verified first |
| Steps | Numbered, each one executable as written |
| Record produced | The audited record, written before any external call |
| Verification | How the operator confirms the effect |
| Rollback | How to undo it, or why it cannot be undone |

A procedure that cannot fill this template is not a runbook yet.

## Incident runbook

### Opening

A **Suspected Incident** opens on any suspicion of unauthorized access, a
leaked or misused credential, or data crossing an outbound boundary, including
customer content or identifiers reaching GlitchTip. The bar is deliberately
low: opening costs nothing and deciding late is the real risk. The Incident
Record is opened immediately with the discovery time, which starts the clock:
fourteen business days to the strictest regulator (Vermont) and thirty days to
affected individuals. "Breach" is an output of the notification decision,
never an entry condition.

### Incident log and evidence

The incident log is private and append-only, in a store whose credentials are
separate from production, such as a private repository. It holds metadata
only: row ids, counts, timestamps, provider log exports, and decisions with
their reasons. Customer content is never copied into it. Content may be read
in place only when scoping requires it, and each such read is its own log
entry. Incident records are kept for three years from closure, a
counsel-review item on the register.

### Containment

1. **Service-Wide Hold** whenever scope is unknown. One audited switch takes
   the product offline except the status page and the Stripe webhook receiver,
   which keeps recording events for reconciliation. Export and deletion are not
   served during the hold: the never-blocked exit is a promise about normal
   operation, not about serving from a possibly compromised system. The
   Privacy Policy wording must allow this.
2. GlitchTip capture is disabled for any suspected outbound-boundary breach.
3. Credentials are rotated per provider in a fixed order: Vercel, Neon,
   Stripe, Resend, AI Gateway, GlitchTip, followed by session revocation.
   Each provider's rotation is its own runbook in the template.
4. The hold is lifted by an audited transition once containment is verified.

### Notification decision

The author decides, after one counsel consultation. Customers are notified by
email whenever there is a reasonable belief that customer content or account
data was acquired; no state risk-of-harm exemption is relied on. The target is
the thirty-day individual clock and the fourteen-business-day regulator clock.

### Non-user notice

When counsel determines notice is legally owed to people without accounts,
the runbook extracts only email-address fields from the breached dataset, with
no content read, and sends the counsel-approved notice. This is compelled
notice, not a response to a request, so
[ADR 0247](../adr/0247-non-user-requests-are-neither-searched-nor-relayed.md)
does not forbid it; the ADR now says so.

## Service Notice procedure

The operator posts the same text to the static status page and the in-app
banner. Notices are content-free and never name a customer. While an incident
notice is open, the status page is updated at least once a day.

## Requests at the support address

- **Account holders** asking for access, export, deletion, or correction are
  pointed to in-app self-service. The manual path exists only when the sender
  cannot sign in: the request must come from the account email and be
  confirmed through a sign-in link, then the Delete on request Operator Action
  applies.
- **Non-user data subjects** receive the fixed ADR 0247 acknowledgement
  template: no search, no relay, and the reason.
- Every privacy or non-user request is tagged and tracked to the
  two-business-day reply promise.

## Deletion-notice sequence

Four content-free emails for a Lapsed Account, measured from Lapsed entry:

| Day | Email |
| --- | --- |
| 0 | Entered Lapsed; data deleted in ninety days; resubscribe and export links |
| 60 | Thirty days left |
| 83 | Seven days left |
| After purge | Deletion confirmation |

A Terminated account gets the same schedule without the resubscribe link. A
Legal Hold pauses the sequence for the data it covers.

## Pre-launch tabletop

Run once, alone, on a timer, against a written scenario: a Neon connection
string leaks through a Vercel preview deployment while a GlitchTip event is
found to contain note text. It passes only if every step executes as written,
every credential location is known from the operations sheet, and the customer
notice and regulator timeline are drafted inside the exercise. Any gap blocks
launch until the runbook is fixed. The result is a dated tabletop report
linked from the Hosted Obligations Register.

## Register additions

| Obligation | Status | Review |
| --- | --- | --- |
| Service-Wide Hold suspends export and deletion; Privacy Policy wording allows it | Decided, unbuilt | counsel review |
| Incident records kept three years from closure | Decided, unbuilt | counsel review |
| Compelled non-user breach notice by email-field extraction only | Decided, unbuilt | counsel review |
| Pre-launch tabletop passed, report dated | Decided, unrun | owner-decided |
