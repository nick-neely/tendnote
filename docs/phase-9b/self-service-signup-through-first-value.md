# Self-service signup through First Value

Prototype artifact for [Prototype self-service signup through first
value](https://github.com/nick-neely/tendnote/issues/569). **Status: decided.**
The owner reviewed the prototype and approved every interaction in it as
prototyped. Visual design, theming, and final wording are explicitly not
settled here: the owner expects to refine them heavily at implementation, so
the prototype's look and copy bind nothing.

The prototype is one self-contained file:
[`prototypes/self-service-signup-through-first-value.html`](prototypes/self-service-signup-through-first-value.html).
Open it in a browser. The left column is the account's state, the phone frame
is what the customer would see, and the guided walkthroughs push the journey
through the awkward cases. The screen copy is direction, not final wording; the
marketing ticket owns public claims.

## What the prototype builds on

It takes as given the [first-value promise](first-paid-customer-and-first-value.md)
(the Launch Customer, the four-step First Value, the fifteen-minute and phone
targets, manual capture only), the
[paid-access lifecycle](subscription-ownership-and-paid-access-lifecycle.md)
(admission on the first paid invoice, card only, the account state machine,
accept-first Household Guest, beta sunset), and the
[hosted obligations](hosted-privacy-and-customer-lifecycle-obligations.md)
(Region Block, clickwrap Acceptance Records, the re-acceptance gate that never
blocks the exit, the launch email set). It does not touch the price, the guest
interface, or the marketing site.

## The approved journey

1. **Landing and pricing.** Readable everywhere, including from blocked
   regions. One plan in a monthly or annual interval
   ([The paid offer and price](paid-offer-and-price.md)), one account, the price, the fourteen-day guarantee, US
   eighteen-plus eligibility, the fair-use budget, and the support promise are
   stated on the pricing page.
2. **Account before payment.** Choosing the offer creates the Better Auth
   account first, with the Terms and Privacy Policy accepted by clickwrap and
   the residency and age statement on the same form. The account is the
   durable thing the paid invoice lands on and the thing a closed tab returns
   to. The Region Block refuses sign-up, sign-in, and checkout entry outside
   the US.
3. **Stripe Checkout.** Card only, billing country restricted to the US, the
   account id passed as `client_reference_id`. Declines are handled inside
   Stripe; leaving is harmless.
4. **Confirming, not admitted.** The return page says the payment is being
   confirmed and polls Tendnote's own admission record. It never calls Stripe.
   Admission happens when `invoice.paid` is projected onto Paid Access, and the
   customer is let in the moment that lands, whether or not they are still on
   the page. If confirmation exceeds a minute, the page promises an email.
5. **The pending area** is the single home for every signed-in, not-admitted
   state that is not Lapsed: never paid, checkout abandoned, declined, or
   expired, beta ended. It states what happened in one line ("nothing was
   charged"), offers exactly Finish subscribing, Export, Delete, Sign out, and
   carries the signed-in identity so the customer knows which account this is.
   [The Household Guest experience](household-guest-experience.md) later
   revised the action set: actions follow what the account owns, so an account
   with nothing to export is not offered Export, and Delete and Sign out are
   always present.
6. **First run.** One prompt on admission: "Who did you talk to this week? Tell
   Eve one thing they said." Skippable. Home repeats the prompt once in the
   empty Today rail and Eve composer. A life-admin first capture is saved as a
   General Action, shown where it lives, and followed by a one-sentence steer
   toward a person.
7. **First Value loop.** Eve proposes the person and a Memory from the first
   sentence; the customer saves and confirms; the person page offers a
   Follow-Up with a suggested date; Today shows where it will resurface; asking
   Eve about that person returns a grounded answer with its sources. The four
   Activation Milestones are stamped along the way. Integrations are offered
   only after this.
8. **Day two.** The Daily Brief and Today carry the Follow-Up. This is the
   Return and the readiness check, not part of First Value.
9. **Later billing** appears as notices on top of an admitted account (Past Due
   with days remaining; Ending with period end), never as a different product.
   Lapsed is its own area with the retention date computed once and shown.

The walkthroughs also cover the invited Household member (accept first, browse
as a guest, subscribe later with the membership intact) and the existing
private-beta account (announced sunset, data intact, re-acceptance of the launch
Terms, subscribe from the pending area).

## Newcomer Walkthrough protocol

The first-value decision handed this ticket the protocol. The owner approved it
as written. Nothing here has been run.

- **Participants.** Two people who are not the author, recruited from outside
  the author's household, who have not seen Tendnote before and have not been
  coached. An uncoached acquaintance qualifies. Two clean passes by different
  people is the target; one is the floor.
- **Payment mode.** Real Stripe Checkout in live mode with a real card of the
  participant's, refunded in full by the author after the session under the
  fourteen-day guarantee, so the checkout under test is the one a customer
  meets. A 100 percent promotion code was the alternative and was not chosen:
  it never exercises the card decline and refund paths.
- **Start.** The participant receives only the public landing URL, on their
  own everyday device. At least one of the two runs is on a phone.
- **Observation.** The author watches in person or over a screen share, may
  ask "what are you thinking?" and never answers a question. One intervention
  fails the run and is logged as a defect to fix before the next run.
- **Timing.** The clock runs from payment confirmation to First Value, read
  from the account's Activation Milestones, not from a stopwatch.
- **Notes.** A short observation record per run: date, device, where the
  participant hesitated or asked something, the milestone timestamps, defects
  found. Content-free: no names or details from what the participant captured.
- **Day-two Return check.** The author confirms on the following day that the
  Daily Brief was sent and the Follow-Up appears on the participant's Today,
  then asks the participant one question by message: did anything arrive, and
  was it right? The participant deletes the account afterwards, or keeps it
  and is refunded regardless.
- **Where it lives.** Observation records under `docs/verification/` next to
  the existing manual verification notes, linked from the launch-readiness
  checklist when that exists.

## Questions the prototype raised, settled as prototyped

The owner's approval covered the interactions as the prototype shows them, so
each question below is answered by what the prototype does.

1. **Abandoned checkout.** No nudge email. A closed tab leaves an Unpaid
   account, no timer, and no message; the pending area explains what happened
   when the customer returns. This keeps the launch email set free of anything
   that reads as marketing.
2. **Never-paid ex-beta accounts.** After the sunset the account is Unpaid with
   its data intact and no retention clock. The ninety-day clock belongs to
   Lapsed, which only an account that held Paid Access can enter. This matches
   the retention table's "while the account exists" row; export and deletion
   stay available from the pending area.
3. **Account before payment.** The account is created first, then Checkout.
4. **Slow confirmation.** After a minute the confirming page promises an email
   on admission. Implementation therefore owes a content-free "you're in"
   message, which falls inside the account and sign-in email category.
5. **Walkthrough payment mode.** Real card in live mode, refunded under the
   guarantee.
6. **First-run prompt.** One skippable prompt on admission, repeated once on
   Home in the empty Today rail and the Eve composer.

## What carries into the specification

- **The pending-area contract:** one home for every signed-in, not-admitted,
  not-Lapsed state; one line of what happened; Finish subscribing, Export,
  Delete, Sign out. Revised by
  [The Household Guest experience](household-guest-experience.md): actions
  follow what the account owns, with Delete and Sign out always present.
- **The confirming page's local-read rule:** it polls Tendnote's admission
  record and never calls Stripe; admission follows the projected paid invoice,
  not the redirect.
- **The first-run path** and the life-admin steer.
- **Billing states as notices** on an admitted account, with Lapsed as its own
  area.
- **The Newcomer Walkthrough protocol** above.

The prototype stays on this branch as the primary source. Its reducer is the
liftable part; the page around it is throwaway. The Household Guest interface
was then decided in [The Household Guest
experience](household-guest-experience.md).
