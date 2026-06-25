<!-- SEED: re-run /impeccable document once there's real design code to capture the actual tokens and components. Hex values, type scale, and component specs are intentionally deferred. -->
---
name: Tendnote
description: A private, calm relationship-memory notebook — not a CRM.
---

# Design System: Tendnote

## 1. Overview

**Creative North Star: "The Field Notebook"**

Tendnote is a quiet, personal notebook for remembering people — not a robot, and
emphatically not a sales CRM. The interface should feel like a well-made field
notebook left open on a desk in late-afternoon light: calm, tactile, and
unhurried, but ready the instant you reach for it. Its three words are **Calm,
Private, Precise** — the stillness of Things or Bear married to the speed and
restraint of Linear. Nothing nags, gamifies, or shouts. The intelligence stays in
the margins, in service of the relationship.

The system is built on a Restrained color strategy: tinted-neutral surfaces and a
single olive/sage brand color that does the emotional work, with one warm-clay
accent held in reserve for action and state. Calm is never an excuse for slow —
capture and recall are immediate, keyboard-reachable, and frictionless. The mood
lives in the brand color and the typography, never in a decorated surface.

This system explicitly rejects: the sales-CRM idiom (pipelines, deal stages, lead
scores, vanity dashboards), the generic "AI product" idiom (purple/blue gradients,
sparkle icons, glowing orbs, robotic avatars), task-manager guilt (red overdue
badges, streaks, nagging counts), and saccharine sentimentality (hearts, greeting-
card tone). It also rejects the 2026 AI-default cream/sand/parchment body
background — warmth here comes from the olive brand color and the type, not a
tinted near-white surface.

**Key Characteristics:**
- Calm by default; low-stimulation, nothing nags or gamifies.
- Fast to capture, fast to recall — calm is not slow.
- Olive/sage brand color carries the warmth; surfaces stay out of the way.
- One voice in type: a single refined sans, with mono reserved for machine facts.
- A notebook, not a robot — the AI stays in the margins.

## 2. Colors

A Restrained palette: tinted-neutral surfaces, a single grounded olive/sage brand
color, and one warm accent held back for action and state. Exact tokens are
deferred to the implementation pass; what's fixed now is the *direction*.

### Primary
- **Olive / Sage** (hue ~110° in OKLCH; exact L/C `[to be resolved during
  implementation]`): the brand color. Grounded, natural, late-afternoon-olive-grove
  calm. Carries identity through quiet placement, not saturation — not a generic
  AI blue or purple. Used for primary actions, current selection, and brand marks.

### Secondary
- **Warm Clay / Terracotta accent** (warm earth hue; value `[to be resolved during
  implementation]`): a single reserved accent, the warm counterpoint to the olive.
  Candidate role: timely follow-ups and the one moment per screen that should draw
  the eye. Optional — confirm during implementation; may collapse into Primary.

### Neutral
- **Ink** (`[to be resolved]`): primary text. Must clear WCAG AA (≥4.5:1) on every
  surface, in both light and dark themes.
- **Muted ink** (`[to be resolved]`): secondary text and metadata. Held to AA, not
  dropped to a low-contrast elegance gray.
- **Surfaces** (`[to be resolved]`): pure white in light, near-black in dark — NOT
  cream, sand, or parchment. A second, slightly cooler/warmer neutral layer for
  panels (the assistant rail, toolbars) sits just off the content surface.
- **Border / divider** (`[to be resolved]`): hairline separation; quiet, never a
  colored stripe.

### Named Rules
**The Quiet Accent Rule.** The olive brand color and the clay accent together
appear on ≤10% of any screen, and only on action and state — never as decoration.
Their rarity is what makes them read as meaningful.

**The Surface Stays Out Of It Rule.** The mood lives in the brand color and the
type. Body surfaces are pure white (light) or near-black (dark) at chroma ~0.
Putting "warmth" into a cream/sand background is prohibited; that warmth belongs to
the olive, not the paper.

## 3. Typography

**Display / Body Font:** A single refined sans for the entire hierarchy — headings,
person names, labels, controls, and body. `[font to be chosen at implementation;
current incumbent: Geist — validate against the calm/precise brief.]`
**Mono Font:** A monospace reserved for machine facts only. `[font to be chosen;
current incumbent: Geist Mono.]`

**Character:** One quiet, well-tuned sans carries everything; the mono is a precision
signal, not a style. The contrast axis is sans-vs-mono and weight, never two similar
sans families paired together.

### Hierarchy
- **Display / Headline** (`[weight + fixed rem size to be resolved]`): screen titles
  and person names. Fixed rem scale, not fluid clamp — product UI views at
  consistent DPI.
- **Title** (`[to be resolved]`): section and card headers.
- **Body** (`[to be resolved]`): notes, memories, and prose. Cap prose at 65–75ch.
- **Label** (`[to be resolved]`): controls and field labels. Sentence case; avoid
  wide-tracked all-caps eyebrows.
- **Mono / Metadata** (`[to be resolved]`): timestamps, IDs, confidence, source —
  the machine facts. Mono earns its place only here.

### Named Rules
**The One Voice Rule.** A single sans family does all the human-facing work. Mono is
admitted only for machine facts (timestamps, IDs, source, confidence). A display
serif or a second sans in UI labels is prohibited.

## 4. Elevation

Flat by default, in keeping with Responsive (not choreographed) motion. Depth is
conveyed through the tonal neutral layers (content surface vs. panel) and hairline
borders, not ambient drop shadows. Shadows appear only as a *response to state* —
a hover lift, a focused field, an elevated popover or dialog — at 150–250ms.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow is a reaction
(hover, focus, elevation), never a resting decoration. If a card has a drop shadow
while idle, it's wrong.

## 5. Components

Deferred. The current components are template-grade shadcn defaults, not authored
design decisions, so documenting them now would codify the placeholder. They will
be specified on the next `/impeccable document` scan-mode pass once a real surface
is built — or as each surface is crafted. The component vocabulary must follow the
product register's bar: every interactive element gets default, hover, focus,
active, disabled, loading, and error states; affordances stay consistent screen to
screen; loading uses skeletons, not centered spinners; empty states teach the
interface rather than say "nothing here."

## 6. Do's and Don'ts

### Do:
- **Do** let the olive/sage brand color carry the warmth and identity; keep it (and
  the clay accent) to ≤10% of any screen, on action and state only.
- **Do** keep body surfaces pure white (light) or near-black (dark) at chroma ~0.
- **Do** hold all text to WCAG AA (≥4.5:1), including muted metadata and placeholder
  text — never drop to a low-contrast elegance gray.
- **Do** use one refined sans everywhere, with mono reserved for machine facts.
- **Do** give every animation a `prefers-reduced-motion` fallback, and never convey
  state (like "follow-up due") with color alone — pair it with text or an icon.
- **Do** keep both light and dark themes first-class and system-aware with a toggle.

### Don't:
- **Don't** adopt the sales-CRM idiom: no pipelines, deal stages, lead scores, or
  vanity-metric dashboards. People are not rows in a funnel.
- **Don't** use generic "AI product" branding: no purple/blue gradients, sparkle
  icons, glowing orbs, robotic assistant avatars, or "chat with your data" energy.
- **Don't** introduce task-manager guilt: no red overdue badges, streaks, or nagging
  unread counts. A missed follow-up is not a failure.
- **Don't** frame a person as a dossier under investigation, and don't get
  saccharine — no hearts or greeting-card tone.
- **Don't** use a cream/sand/parchment body background, gradient text, decorative
  glassmorphism, or a colored side-stripe border on cards or list items.
