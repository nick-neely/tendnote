---
name: Tendnote
description: A private, calm relationship-memory notebook - not a CRM.
---

# Design System: Tendnote

## 1. North Star

**Creative north star: The Field Notebook.**

Tendnote is a quiet personal notebook for remembering people. It should feel like
a well-made field notebook open on a desk in clear late-afternoon light: calm,
tactile, private, and ready the instant the user reaches for it. The product is
not a sales CRM, not an AI chat wrapper, and not a task manager trying to create
guilt. Its three words are **Calm, Private, Precise**.

The visual system combines three lanes:

- **Field Notebook** for the default light UI: pure white surface, vegetal sage
  identity, clay accent held back, flat panels, and hairline structure.
- **Quiet Workbench** for dark mode: near-black workspace, sage focus color,
  subdued panels, and command-palette density.
- **Personal Ledger** for profile/detail views: tighter typographic hierarchy,
  thin rules, human content first, metadata in quieter mono or capsule treatment.

Scene sentence: Nick opens Tendnote in a quiet morning or late-afternoon pocket of
time, often for under a minute, trying to remember a person without feeling
managed by software.

Anchor references: **Things** for calm task restraint, **Bear** for private
notebook warmth, and **Linear** for speed and precision.

## 2. Product Guardrails

- Relationships, not records. People are never framed as leads, accounts,
  opportunities, profiles under investigation, or rows in a funnel.
- Calm by default. No red overdue energy, streaks, nagging unread counts, vanity
  dashboards, or gamified progress.
- Fast to capture, fast to recall. Calm must not become slow or precious.
- Explicit approval before anything leaves the app. External sends and external
  draft creation are never automatic.
- Intelligence stays in the margins. No sparkles, robot avatars, purple/blue AI
  gradients, glowing orbs, or "chat with your data" visual language.

## 3. Color System

Strategy: **Restrained**. Sage and clay together should occupy no more than about
10% of a screen. They are used for action, selection, state, and sparse brand
moments - never decoration.

Surfaces stay pure: light mode uses white, dark mode uses near-black. Do not warm
the whole product with cream, sand, parchment, beige, or paper-tinted backgrounds.
Warmth belongs to sage, clay, typography, and copy restraint.

### Token Candidates

These are the current working tokens in `src/app/globals.css`.

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.18 0.018 145);
  --surface: oklch(0.975 0 0);
  --panel: oklch(0.955 0.006 145);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.18 0.018 145);
  --primary: oklch(0.39 0.085 142);
  --primary-foreground: oklch(0.99 0 0);
  --secondary: oklch(0.955 0.006 145);
  --secondary-foreground: oklch(0.24 0.025 145);
  --muted: oklch(0.955 0.006 145);
  --muted-foreground: oklch(0.43 0.018 145);
  --accent: oklch(0.48 0.12 38);
  --accent-foreground: oklch(0.99 0 0);
  --accent-soft: oklch(0.94 0.035 38);
  --border: oklch(0.88 0.006 145);
  --input: oklch(0.88 0.006 145);
  --ring: oklch(0.56 0.095 142);
}

.dark {
  --background: oklch(0.09 0 0);
  --foreground: oklch(0.96 0 0);
  --surface: oklch(0.13 0.004 145);
  --panel: oklch(0.17 0.006 145);
  --primary: oklch(0.66 0.105 142);
  --primary-foreground: oklch(0.09 0 0);
  --accent: oklch(0.64 0.12 38);
  --accent-foreground: oklch(0.09 0 0);
}
```

### Semantic Roles

- **Background**: page canvas. Pure white or near-black.
- **Surface**: cards, list rows, quiet content blocks.
- **Panel**: assistant rail, toolbars, sidebars, grouped controls.
- **Primary sage**: primary action, current selection, focus, brand mark.
- **Clay accent**: timely follow-ups, review-needed state, one important moment
  per screen. Do not use it for every badge.
- **Muted foreground**: secondary text and metadata. It must remain readable;
  never use low-contrast "elegant gray."
- **Destructive**: actual destructive actions only. Do not use red for missed or
  delayed follow-ups.

## 4. Typography

Tendnote uses one human-facing sans family. Geist is acceptable for now because it
is restrained and precise; revisit only if it starts feeling too generic after
real Phase 1A screens exist. Geist Mono is reserved for machine facts only:
timestamps, source labels, IDs, confidence, and diagnostic metadata.

Fixed product scale:

| Role | Size / line | Use |
| --- | --- | --- |
| Display | `32 / 40` | Person names, top-level dashboard headline |
| H1 | `24 / 32` | Screen titles |
| H2 | `20 / 28` | Major sections |
| Title | `16 / 24` | Card titles, list row names |
| Body | `15 / 24` | Notes, memories, normal prose |
| Small | `13 / 20` | Supporting copy, helper text |
| Caption | `11 / 16` | Dense metadata only |

Rules:

- Product typography is fixed rem scale, not fluid clamp.
- Headings use normal tracking. Never tighten below `-0.02em`.
- Labels are sentence case. Avoid wide-tracked all-caps eyebrows.
- Prose caps at 65-75ch. Dense metadata may be wider.

## 5. Layout System

The app shell uses a simple top bar and constrained workspace. Prefer obvious
product patterns over invented affordances.

- **Dashboard**: two columns on desktop — the assistant (capture/recall chat) as
  the working column on the left, and a quiet right rail holding Today, **Needs
  review**, and People. On mobile the assistant leads at the top, directly under
  the greeting, so capture is the first thing in reach; the rail follows below it.
  The assistant carries the dashboard but must stay a notebook, not a chat product:
  no transcript persistence, no assistant-as-destination framing.
- **Dashboard review rail**: open suggested-memory reviews surface inline in the
  rail with a compact Save (approve) / Dismiss affordance, so the common case is
  handled without opening each person. The full review (edit wording, sensitivity,
  archive) still lives on the person's ledger, which each row links to. The whole
  "Needs review" section hides when nothing is waiting — an empty queue is not
  worth a heading, and there is no count badge or backlog framing. Keep it short
  (a handful of the most important suggestions); the long tail stays on the
  person pages, never a guilt-inducing inbox.
- **People list**: card/list hybrid with human details first and metadata second.
  Cards may be dense but should not become CRM tiles.
- **Person detail**: Personal Ledger density. Use thin rules, flat rows, and
  compact metadata. Memories and follow-ups should read like context attached to a
  person, not pipeline activity.
- **Capture surfaces**: fast, keyboard-reachable, inline where possible. Avoid
  modal-first flows.
- **Assistant/review surfaces**: panel treatment with explicit approval language.
  Outbound actions require visible confirmation.

Spacing should feel quiet but not airy. Default rhythm is `4, 6, 8, 12, 16, 24,
32`; use `48` only for major page separation.

## 6. Components

### Buttons

- Primary: sage fill, white text in light mode, near-black text in dark mode.
  Used for the primary action only.
- Secondary: neutral panel fill for non-primary commands.
- Outline: hairline border, white/near-black fill. Good for secondary workflow
  actions.
- Ghost: navigation and low-emphasis controls.
- Destructive: only for destructive action, not overdue or warning states.

Every button needs default, hover, focus, active, disabled, and loading treatment.
Focus rings use sage and must be visible in both themes.

### Cards and Rows

Cards are flat by default: border plus surface fill, no idle drop shadow. Hover may
change border or surface tone. Do not combine a border with a wide soft shadow.

Use cards for repeated entities or framed tools only. Avoid nested cards. For
person-detail content, prefer rows inside one surface over a grid of decorative
cards.

### Badges

Badges carry state or metadata. They are not decoration.

- Secondary badges: neutral relationship metadata.
- Outline badges: source, confidence, birthday, status labels.
- Primary badges: current selection or confirmed active state.
- Clay accent: reserved for review-needed/timely follow-up states once those
  states exist.

State must never be color alone; include text or icon.

### Inputs

Inputs are quiet, bordered, and fast. Placeholder text must be readable. Field
focus uses sage ring and border. Error states use destructive color plus a message.

### Assistant Panel

The assistant panel uses `panel` background, border separation, and explicit
approval language. It should feel like a margin note or workbench, not the center
of the product.

Eve's turns render trust-weighted result cards (saved memory = sage/confirmed,
logged context = neutral, tentative suggestion = clay). One of these is
interactive: the **tentative suggestion card** ("Ready to review") carries inline
Approve / Dismiss, so the user can resolve a suggestion without leaving chat. On
action it resolves in place — Approve flips it to the confirmed (sage) treatment
("Saved to memory"), Dismiss settles it to a quiet neutral state — using the same
owner-scoped review mutations as the dashboard rail and person ledger. Keep the
other cards read-only; only a genuinely actionable, trust-bearing item earns
buttons. Cards name the person and show the record's content; never surface a raw
id. The full review (edit wording, sensitivity, archive) stays on the person
ledger, which the card links to.

### Empty States

Empty states teach the next action without guilt:

- Good: "No memories captured yet."
- Better when actionable: "Add the first detail you want to remember about this
  person."
- Avoid: "You're behind", "No activity", "Start your pipeline."

### Loading

Use skeletons shaped like the eventual content. Avoid centered spinners except for
small isolated controls.

For transient "thinking" / "working" copy (Eve's in-flight tool lines), use the
**processing shimmer** (`Shimmer` in `components/ui/shimmer.tsx`, `.tn-shimmer*` in
`globals.css`). It stacks two copies of the text: a solid `muted-foreground` base
that is always readable, and a `foreground`-ink band masked into a sweep on top —
a calm wave of ink moving through the word. This is the **one sanctioned way** to
shimmer text here; do not reach for the common alpha-only mask (sweeping the text's
opacity), which dims the text toward the page background and collapses to ~1.6:1 on
a white surface — the light-mode washout we explicitly rejected. The rules: never
let the text go transparent (the base layer guarantees legibility — every frame of
the sweep stays 8:1–18:1 in both themes); keep it a single-hue luminance wave, never
`background-clip: text` over a multi-color gradient (that is the banned gradient
text); let the theme tokens flip it (it darkens in light, brightens in dark, with no
theme-specific CSS); and honor reduced motion by dropping the band to the static
base line. Pair it with the pulsing sage dot, which carries most of the liveliness —
the shimmer stays a whisper, not a sheen.

### Scrollbars

Tendnote uses a **custom themed scrollbar** (see `globals.css`): a slim rounded
pill with no track and no arrow buttons, in a **neutral ink tint** that darkens on
hover/active. This is a deliberate, documented exception to the generic "don't
restyle scrollbars" product caution — the chunky OS default with arrow buttons
reads as foreign chrome inside a calm, intentional surface. The rules: the flair
is the form (slim pill, no buttons), not color; keep it a neutral ink tint, **not
sage** — a branded scrollbar competes with the primary action and over-greens the
screen; and keep the thumb clearly visible and mouse-operable in both themes.
`scrollbar-width: thin` + `scrollbar-color` cover Firefox; `::-webkit-scrollbar-*`
cover Chromium. Do not push this into novelty (no animated, oversized, or
hidden-until-hover scrollbars) — on-brand and unobtrusive, not a gimmick.

## 7. Motion

Motion is responsive, not choreographed.

- Standard transitions: `150-220ms`.
- Ease: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Animate color, border, opacity, and small transform feedback.
- Do not animate layout unless needed for a direct state transition.
- No page-load entrance choreography.
- Reduced motion collapses transitions to near-instant.

## 8. Accessibility

- Body text must meet WCAG AA; target stronger contrast for notes and memories.
- Placeholder and muted text must remain readable.
- Keyboard operation is required for capture, navigation, assistant review, and
  approval flows.
- Focus states must be visible and consistent.
- Do not convey follow-up urgency or approval state by color alone.
- Both light and dark token sets are first-class; light is the default UI.

## 9. Voice and Copy

Voice is warm, plain, and respectful. It should sound like a trusted notebook, not
therapy copy, productivity copy, or sales software.

Preferred language:

- People, memories, notes, follow-ups, drafts, review, approval.
- "Remember", "capture", "review", "keep", "save".

Avoid:

- Leads, pipeline, deals, stages, accounts, opportunities, scoring.
- Autopilot, autonomous outreach, growth, nurture, campaign.
- Guilt language like overdue, missed, failing, streak, inbox zero.

Approval copy should be direct: "No external sends", "Review before sending",
"Draft saved for approval".

## 10. Implementation Priorities

For Phase 1A:

1. Build from the global token layer in `src/app/globals.css`; do not hard-code
   one-off colors in components unless a semantic token is missing.
2. Keep the dashboard and people surfaces light-default Field Notebook.
3. Use Personal Ledger density on person detail, memory review, and source
   metadata.
4. Keep Eve/assistant surfaces visually secondary and approval-gated.
5. Re-run `/impeccable document` after the first real Phase 1A surface is built
   so this file can capture components from production code rather than seed
   intent.

## 11. Do / Don't

Do:

- Use sage sparingly for action, selection, focus, and the mark.
- Keep surfaces pure white or near-black.
- Let person content lead before metadata.
- Use mono only for machine facts.
- Prefer inline flows over modals.

Don't:

- Add CRM pipelines, lead scoring, deal language, or vanity dashboards.
- Add AI-purple gradients, sparkles, glowing orbs, or robot avatars.
- Use cream, sand, parchment, beige, or paper-tinted body backgrounds.
- Use decorative shadows, glassmorphism, gradient text, or colored side stripes.
- Use red to shame missed follow-ups.
