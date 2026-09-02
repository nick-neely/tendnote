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

Tendnote is set in the **IBM Plex** superfamily — one voice in three registers,
wired through `next/font` and the `--font-sans` / `--font-mono` / `--font-display`
tokens in `globals.css` (never literal family names, which do not match
`next/font`'s hashed `@font-face` families).

- **IBM Plex Sans** — the human-facing UI type. It carries everything: body,
  labels, buttons, list rows, and all headings (including dialog, card, and
  alert-dialog titles via `--font-heading`, which stays `= --font-sans`). Weights
  400 / 500 / 600.
- **IBM Plex Serif** — the display serif, and **only** a display serif. It is
  reserved for true display moments and warms them without turning literary. It
  appears on exactly four surfaces: the dashboard greeting, the person name at
  display size, the asset-profile headline, and the auth title — all via the
  `font-display` utility (`--font-display`), at weight 600, normal tracking. It is
  **banned** from dense UI: never in buttons, labels, list rows, metadata, or any
  13px / 11px text. If a surface is not one of those four display headlines, it is
  sans. Weights 500 / 600 only (serif never renders at body weight).
- **IBM Plex Mono** — machine facts only: timestamps, source labels, IDs,
  confidence, and diagnostic metadata. Weights 400 / 500.

### Wordmark lockup

The "Tendnote" wordmark (`components/tendnote-logo.tsx`) is live text, not a
raster — it sits beside the raster Tended Memory mark. It is set in **IBM Plex
Sans** (the humanist sans pairs with the heavy rounded mark — **not** the serif),
weight **600**, tracking **-0.01em**, line-height **1**, in a single ink color
(`text-foreground`, **not** sage — one branded color per lockup, and the mark
already carries it). The wordmark is sized so its cap-height reads at roughly
**55–62%** of the visible mark: **~17px** beside the 28px header mark, **~19px**
beside the 32px auth mark. These pairings are baked into the component's `size`
variant (`header` / `auth`); call sites pass a size, not per-instance font styling.

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
  The assistant carries the dashboard but stays a notebook in tone: no
  "chat with your data" framing, no avatar, no AI theatre.
- **Assistant page** (`/assistant`, `/assistant/[sessionId]`): the one place the
  assistant is a destination. Desktop is a 260px collapsible conversation rail
  (`panel` surface, grouped Today / Yesterday / Previous 7 days / Older, rename
  and archive per row, no delete) beside a centered 44rem transcript column with
  the composer pinned to its bottom. An empty conversation centers the greeting,
  composer, and suggestion chips; the first message settles the layout into
  transcript-over-composer in one 200ms transition. Threads are Tendnote-owned
  titles over Eve sessions (ADR 0238): the transcript is readable history, never
  the source of truth, so there is no export, share, or download. A thread whose
  session has ended stays readable and swaps the composer for a quiet "Start a
  new conversation" notice; never show a composer that will fail. Phone: one
  header, the rail as a sheet, full-bleed transcript, composer above the
  safe-area inset.
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

Spacing should feel quiet but not airy. Default rhythm is `4, 6, 8, 12, 14, 16,
24, 32`; use `48` only for major page separation. Use `14px` (`3.5`) for compact
rows, cards, and controls that need a little more room than `12px` without the
breadth of `16px`.

**Phone gutter.** The one exception to that rhythm, and the only one: every
narrow-viewport surface is inset from the screen edge by **20px**, declared as
`px-gutter` (`--tn-gutter` in `globals.css`) and cancelled - for a bar that must
reach the screen edges, like the person and asset ledger toolbars - by
`mx-bleed`. It sits between the rhythm's 16 and 24 deliberately: 16 read cramped
against a full-width card on a 390px phone, and 24 spent too much of that width
on nothing. It is a layout constant, not a rhythm step, so it is never a
substitute for `p-4` / `gap-6` inside a surface. A mobile surface must not
hand-pick its own edge inset; that drift is what produced screens sitting at 12,
16, 20, and 32 at the same time. Wider viewports step up to `sm:px-6`.

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
approval language. Its name is **"Assistant"** on every surface; Eve is the
framework underneath and never appears in copy, labels, or routes. The only
identity mark is an 8px sage dot before the word "Assistant" — no avatar, no
sparkle, no robot. On the dashboard it is a working column; on `/assistant` it
fills the page; in the mobile capture sheet it renders full-bleed under one
header (never a card inside a sheet).

**Turn anatomy.** Every assistant turn renders, in order:

1. **Activity disclosure** — one per turn, collapsed once finished. It holds the
   model's reasoning summary and each tool call as a labelled step ("Searching
   people", "Loading Priya's context") with pending / active / complete state and
   a one-line human summary where the result offers one. While streaming the
   trigger reads "Working…" in the sanctioned `Shimmer` with the pulsing sage
   dot; when done it reads "Thought for Ns" or "Worked for Ns", with N derived
   from the durable stream timestamps so it survives reload and resume. Raw tool
   names never appear outside the dev-only debug trace, and line-tier tool
   results live only here — nothing trails under the answer.
2. **Answer** — markdown prose, one block per model step.
3. **Result cards** — the trust-weighted cards (saved memory = sage/confirmed,
   logged context = neutral, tentative suggestion = clay) and the interactive
   ones: review, follow-up, general action, asset, draft, and the **approval
   card** for in-turn owner approval (ADR 0237). Interactive cards resolve in
   place using the same owner-scoped mutations as the rail and ledger. Keep the
   rest read-only; only a genuinely actionable, trust-bearing item earns buttons.
   Cards name the person and show the record's content; never surface a raw id.
4. **Sources strip** — "Used N sources", collapsed, only when the turn searched or
   fetched the web. Plain titled links, no favicons or previews.
5. **Actions row** — ghost icon buttons revealed on hover / focus-within (always
   visible on coarse pointers): Copy, Retry. User turns get Edit, which loads the
   text back into the composer. No thumbs, share, or download.
6. **Follow-up suggestions** — at most three chips under the latest completed
   turn, derived by the app from what the turn produced (ADR 0027), gone as soon
   as the user sends anything.

Authorization challenges (a connection needing sign-in) render as a tentative
card with the sign-in link and code; file parts render as attachment thumbnails.
Reasoning text goes through the same guarded markdown as the answer (images are
rewritten to links).

**Composer.** A bordered box: textarea, then a control row with the "+" evidence
menu, the "Enter to send · Shift + Enter for a new line" hint, and a submit that
morphs into Stop while a turn runs. A picked evidence file shows as an inline
attachment chip (display only; evidence still routes through the shared asset
capture, never into the turn — ADR 0185). Typing while a turn runs is allowed:
messages queue in a "Queued" strip above the composer with Send now (interrupt)
and Remove, and drain one per settled turn.

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
4. Keep assistant surfaces approval-gated; the dashboard column stays a
   working column, and only `/assistant` treats it as a destination.
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
