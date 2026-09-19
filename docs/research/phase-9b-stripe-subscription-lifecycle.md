# Stripe subscription lifecycle constraints for hosted access

Researched 2026-09-14 UTC from public primary sources for [Research Stripe subscription lifecycle constraints for hosted access](https://github.com/nick-neely/tendnote/issues/566). Provider facts below inform an application-owned entitlement; they do not choose individual versus Household billing.

## Hosted interfaces

Checkout accepts recurring Prices in subscription mode, can reuse or create a Customer, and supplies `client_reference_id` for internal reconciliation. [Checkout Session API](https://docs.stripe.com/api/checkout/sessions/create)

The hosted portal supports billing-information and payment-method updates, invoice viewing/payment/download, and immediate or period-end cancellation. Multi-product and usage-based subscriptions restrict portal updates; scheduled subscription updates restrict cancellation too. [Portal capabilities](https://docs.stripe.com/customer-management)

Authenticate the customer before creating their portal session. [Portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal)

## Payment-first access

For initial automatic collection, `incomplete` can mean missing payment or authentication; the initial payment window is 23 hours before `incomplete_expired`. `trialing` is a trial. `active` does not prove all invoices were paid: delayed methods such as ACH can activate during processing and remain active after later failure. `past_due` can become `unpaid`, `canceled`, or remain `past_due`, depending on recovery settings. Trial-related `paused` differs from pausing collection. [Lifecycle](https://docs.stripe.com/billing/subscriptions/overview)

Stripe documents `invoice.paid` with active subscription state as provisioning inputs; `invoice.payment_failed` and `invoice.payment_action_required` identify failure and authentication work, while subscription updates/deletion signal lifecycle changes. Payment and access should therefore be verified server-side, independently of browser navigation. [Subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)

**Still product choices:** payment methods, trials/free invoices/credits, evidence sufficient to grant access, renewal grace, access during recovery, and beta-user migration. Card-only is a possible scope reduction, not a settled decision.

## Authenticity, duplicate delivery, and recovery

Verify the raw request body with `Stripe-Signature` and the endpoint secret; test and live secrets differ. Delivery can duplicate or arrive out of order. Event timestamps have second precision and cannot establish total order. Record processed event IDs and make business effects idempotent, including when separate Event objects represent duplicate notifications. Live retry lasts up to three days; Dashboard resend lasts 15 days and CLI resend 30 days. [Webhook contract](https://docs.stripe.com/webhooks)

Recovery can list undelivered events from the last 30 days and must tolerate concurrent automatic retries. [Undelivered-event recovery](https://docs.stripe.com/webhooks/process-undelivered-events)

Subscription listing excludes canceled subscriptions by default; `status=all` includes them. [List subscriptions](https://docs.stripe.com/api/subscriptions/list)

**Design inference:** one idempotent application reconciliation entry point should serve events and recovery, retrieving current billing objects and protecting concurrent writes for the same billing subject. Merely accepting HTTP delivery is not durable completion. Avoid overwriting current access with stale snapshots. An operator-triggered reconciliation path may suffice initially; scheduled automation is a separate reliability decision. Recover from current objects when event history is insufficient.

## Cancellation and refunds

Period-end cancellation preserves the remaining subscription period and can be reversed before it ends. Actual cancellation is terminal; returning customers need a new subscription. Scheduling emits `customer.subscription.updated`; actual cancellation emits `customer.subscription.deleted`. Refund/proration and outstanding invoice handling are separate concerns. [Cancellation](https://docs.stripe.com/billing/subscriptions/cancel)

Refunds apply to payments, may be full or partial up to the original total, and return to the original payment method. Insufficient balance can leave card refunds pending; refunds can fail. Original processing fees are not returned. [Refunds](https://docs.stripe.com/refunds)

**Still product choices:** cancellation timing, refund eligibility, access consequences, disputes, and retention/export/deletion. Refund, cancellation, and access revocation are not one provider operation.

## Neutral entitlement boundary

**Decision input, not selected architecture:** associate Stripe Customer/subscription IDs with an application billing subject. Derive local access state, reason, and effective interval from verified billing evidence plus explicit policy. Keep payer identity, billing authority, membership, and data ownership distinct so a later decision can select individual or Household ownership. Authorize Checkout/portal creation against that subject; a supplied Customer ID is not ownership proof.

## Limits and later verification

No Stripe account, configuration, payment, or live webhook was inspected or changed. These are public documentation contracts, not confirmation of Tendnote's configuration. Pin API/SDK versions during implementation. No legal or tax conclusion is made.

Later verification should cover browser abandonment after payment, pending/failed authentication, duplicate/reordered events, concurrent reconciliation, renewal failure/recovery, scheduled/immediate cancellation, and pending/failed refunds. This research unblocks selecting an explicit access state table and recovery policy.
