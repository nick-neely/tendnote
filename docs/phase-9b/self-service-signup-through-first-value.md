# Self-service signup through First Value

Prototype artifact for [Prototype self-service signup through first
value](https://github.com/nick-neely/tendnote/issues/569). **Status: proposal
awaiting owner reaction.** Nothing below is decided until the ticket's
resolution comment says so; the ticket resolves through the owner's feedback on
the prototype, not through this document.

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

## The proposed journey

1. **Landing and pricing.** Readable everywhere, including from blocked
   regions. One plan, one account, the price, the fourteen-day guarantee, US
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

## Newcomer Walkthrough protocol (proposed)

The first-value decision handed this ticket the protocol. This is the proposal
for the owner to react to. Nothing here has been run.

- **Participants.** Two people who are not the author, recruited from outside
  the author's household, who have not seen Tendnote before and have not been
  coached. An uncoached acquaintance qualifies. Two clean passes by different
  people is the target; one is the floor.
- **Payment mode.** Real Stripe Checkout in live mode with a real card of the
  participant's, refunded in full by the author after the session under the
  fourteen-day guarantee, so the checkout under test is the one a customer
  meets. Alternative for the owner to weigh: a 100 percent promotion code,
  which keeps the flow real but never exercises the card decline and refund
  paths.
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

## Open questions for the owner

Each is exposed by a walkthrough and shown on the phone where it arises.

1. **Abandoned checkout nudge.** After a closed tab, send one "finish setting
   up" email after twenty-four hours, or stay silent? The launch email set has
   no marketing mail; this sits on the line.
2. **Never-paid ex-beta accounts.** When the beta sunsets and an account never
   subscribes, does it get the ninety-day Lapsed clock and deletion notices, or
   does it sit in Unpaid indefinitely? The lifecycle only clocks accounts that
   held Paid Access.
3. **Account before payment.** The prototype creates the account first. The
   alternative, Checkout first with the account created from the Stripe
   Customer email on return, removes a form but complicates matching and the
   returning-customer path. Confirm the order.
4. **Slow confirmation copy.** After one minute of confirming, is "we'll email
   you the moment you're in" a promise the operator can keep at launch, or
   should the page just say "sign in later"?
5. **Walkthrough payment mode.** Real card plus refund, or a full promotion
   code? See the protocol above.
6. **First-run prompt placement.** One interstitial on admission then Home, or
   land on Home with the prompt inside the Eve composer only?

## What happens after the owner reacts

The resolution comment records the answers and any changes to the journey. The
prototype stays on this branch as the primary source. Any durable shape it
settles (the pending-area contract, the confirming page's local-read rule, the
first-run prompt, the walkthrough protocol) goes into the specification and,
where warranted, an ADR. The Household Guest interface stays with its own
ticket.
