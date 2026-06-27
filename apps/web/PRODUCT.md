# Product

## Register

product

## Users

**Primary — Nick.** A software consultant who wants a private place to remember
relationship context: who people are, what's going on in their lives, birthdays,
and the small follow-ups that keep a relationship warm. He reaches for Tendnote in
spare moments — jotting a detail right after a conversation, scanning a short
morning brief, drafting a quick check-in. He values privacy and speed and does not
want another task manager guilt-tripping him.

**Future — shared household (Nick + Mara).** Shared social context, family events,
gift ideas, and household reminders, while private notes stay scoped to the right
person.

**Future — developer / self-hoster.** A technical user who forks or deploys the
template with their own data and storage.

Context of use: personal, frequent, often quick. The stakes feel low moment to
moment but the subject matter — real relationships — is meaningful, so the tool
must feel trustworthy and respectful, never clinical.

## Product Purpose

Tendnote is a relationship memory and follow-up layer for personal life — friends,
family, professional networking, and eventually a shared household. It stores
structured relationship context, surfaces a small number of timely follow-ups
(1–3 per day by default), and drafts thoughtful messages in the user's own voice.
Every outbound action stays behind explicit approval; the agent never sends on its
own.

It is deliberately **not a CRM**. Success looks like: capturing a person, note, or
follow-up in under 30 seconds; briefs that feel useful rather than nagging; and
zero un-approved sends. The product must be genuinely useful with manual entry
alone, before any Gmail, Calendar, or Contacts integration exists.

## Brand Personality

**Calm. Private. Precise.**

Above all, Tendnote is a quiet sanctuary for remembering people — unhurried,
low-stimulation, journal-like (the Things / Bear half of its references). But calm
is not slow: capture and recall happen in seconds, the interface is keyboard-
reachable, and nothing gets in the way (the Linear half). The voice is warm but
never sentimental or saccharine — honest, plain-spoken, and respectful of the
relationships it holds. Drafts read like the user wrote them, never fake-warm.

It should feel like a trusted personal notebook, not an "AI product" and not
software for managing a pipeline. Emotional goals: trust, calm, and quiet
confidence — never urgency, guilt, or gamification.

## Anti-references

- **Sales CRMs (Salesforce, HubSpot, Pipedrive).** No pipelines, deals, lead
  scores, stages, or dashboards of vanity metrics. People are not rows in a funnel.
- **Generic "AI product" branding.** No purple/blue gradients, sparkle icons,
  glowing orbs, robotic assistant avatars, or "chat with your data" hero energy.
  The intelligence stays quiet.
- **Task-manager guilt.** No red overdue badges, streaks, nagging unread counts, or
  productivity-cult framing. A missed follow-up is not a failure.
- **Surveillance / dossier vibes.** Nothing that frames a person as a profile under
  investigation or feels like data-harvesting.
- **Saccharine sentimentality.** No hearts everywhere or greeting-card tone. Warmth
  comes from restraint and good copy, not decoration.

## Design Principles

1. **Relationships, not records.** Design for remembering a person, not managing a
   row. Center the human in language and layout; resist CRM table-and-pipeline
   reflexes.
2. **Calm by default.** The interface should lower stimulation, not raise it. No
   nags, badges, streaks, or manufactured urgency. Suggestions stay few and gentle,
   and anything can be dismissed without guilt.
3. **Fast to capture, fast to recall.** The whole value is friction-free memory.
   Capture in seconds, keyboard-reachable, instant recall. Calm is not an excuse
   for slow.
4. **Earn trust through restraint.** Explicit approval before anything leaves the
   app; the agent never oversteps. Privacy and honesty are felt in the UI, not just
   promised in copy.
5. **A notebook, not a robot.** It should feel like a personal, human tool. The
   intelligence is in service of the relationship and stays in the background.

## Accessibility & Inclusion

- **WCAG AA throughout.** Body text ≥4.5:1 contrast in both themes; large text
  ≥3:1. Watch muted-gray-on-tinted-surface, the most common failure.
- **Both themes first-class.** Light and dark are system-aware with a user toggle;
  neither is an afterthought. (Today the app force-applies dark — that becomes a
  real, well-built choice.)
- **Full keyboard operability.** Capture, recall, navigation, and approval flows are
  all reachable and usable by keyboard, with visible focus states.
- **Reduced motion is honored.** Every animation has a `prefers-reduced-motion`
  fallback (crossfade or instant).
- **Never color alone.** State like "follow-up due" is conveyed with text or icon in
  addition to color.
