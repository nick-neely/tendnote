# Operations runbooks

The procedures the operator follows alone, in one template
([the runbook decision](../phase-9b/hosted-runbooks-and-tabletop.md)). They are
public: none of them is secret, and self-hosters can reuse them.

## The template

Every runbook has these sections, in this order. A procedure that cannot fill
them is not a runbook yet. `scripts/operations-runbooks.test.ts` checks it.

| Section | Holds |
| --- | --- |
| Trigger | The event or request that starts it |
| Preconditions | What must be true or verified first |
| Steps | Numbered, each one executable as written |
| Record produced | The audited record, written before any external call |
| Verification | How the operator confirms the effect |
| Rollback | How to undo it, or why it cannot be undone |

## The operations sheet

One private operations sheet, outside the repository, holds what is secret:
provider account ids, contact routes, credential locations, and counsel's
contact. Runbooks name its entries in bold and never copy from it. Its entries
are the ones [#652](https://github.com/nick-neely/tendnote/issues/652) lists:
**Vercel**, **Neon**, **Stripe**, **Resend**, **AI Gateway**, **GlitchTip**,
**Vercel Blob**, **Redis**, **Operator alerts**, **Synthetic check**,
**OAuth apps**, **Discord bot**, **Domains**, **Status page**, **GitHub**,
**Incident log**, **Support mailbox**, **Counsel**, **Regulators**, and
**Neely Solutions LLC**.

A command below that reads production's environment runs from `apps/web` after
`vercel env pull .env.local --environment=production`. Delete `.env.local` when
the runbook is done.

## Incidents

- [Incident](incident.md): a Suspected Incident, from discovery to closure.
- [Service-Wide Hold](service-wide-hold.md): take the product offline while
  scope is unknown.
- [Service Notice](service-notice.md): post, update, and clear the notice on the
  status page and the in-app banner.
- [Restore](restore.md): restore the whole service to a point in the Backup
  Window.

### Credential rotation

Rotate in this order, each provider by its own runbook. When scope is unknown,
rotate all of them. While a Service-Wide Hold is in force, any verification
that needs the app to answer waits until the hold is lifted.

1. [Vercel](credential-rotation/vercel.md)
2. [Neon](credential-rotation/neon.md)
3. [Stripe](credential-rotation/stripe.md)
4. [Resend](credential-rotation/resend.md)
5. [AI Gateway](credential-rotation/ai-gateway.md)
6. [GlitchTip](credential-rotation/glitchtip.md)
7. [Other credentials](credential-rotation/other-credentials.md): OAuth apps,
   Redis, the alert channel, and Web Push. This step is an addition to the
   decided six. Each of these credentials sits in the same environment.
8. [Sessions](credential-rotation/sessions.md): always last.

## Requests

- [Support requests](support-requests.md): everything that arrives at the
  support address.

## Operator Actions

The only ways the operator changes a customer account
([ADR 0248](../adr/0248-admission-exceptions-live-inside-their-condition.md)).
Each writes its record, and journals it, before any Stripe call. There is no
admin UI. Every action but Delete on request and Suspension Credit is a
command, `pnpm --filter @tendnote/web operator <action>`. The Suspension
Credit is issued by the lift that ends a suspension, or by a termination. Each
command prints its outcome as JSON and exits non-zero with a message when it
refuses or fails. Running it again resumes an action that failed part-way.

| Action | Runbook |
| --- | --- |
| Extend dunning once | [extend-dunning.md](operator-actions/extend-dunning.md) |
| Re-admit after a won dispute | [readmit-dispute.md](operator-actions/readmit-dispute.md) |
| Refund | [refund.md](operator-actions/refund.md) |
| Raise the Account Ceiling for the current period | [raise-ceiling.md](operator-actions/raise-ceiling.md) |
| Temporary Suspension, and renewing its review | [temporary-suspension.md](operator-actions/temporary-suspension.md) |
| Lift a suspension | [lift-suspension.md](operator-actions/lift-suspension.md) |
| Termination | [termination.md](operator-actions/termination.md) |
| Suspension Credit | [suspension-credit.md](operator-actions/suspension-credit.md) |
| Legal Hold | [legal-hold.md](operator-actions/legal-hold.md) |
| Delete on request | [delete-on-request.md](operator-actions/delete-on-request.md) |

To find an account id from an email address, against production's database:

```sql
select id from "user" where lower(email) = lower('<email>');
```

## Launch and checks

- [Move to the app subdomain](app-subdomain-move.md)
- [Provision the synthetic First Value check](synthetic-first-value-check.md)
