# Instant shell prototype

Throwaway visual prototype for
[Validate representative instant shells and transition states](https://github.com/nick-neely/tendnote/issues/292).
This branch is a primary-source artifact and must not merge into `main` or the shared
planning branch.

## Question

Which transition treatment lets Today, People, person detail, Review, and Account
acknowledge navigation within 100 ms, preserve layout, and remain calm without
changing Tendnote's visual language?

The prototype deliberately separates the destination's stable frame from content
that streams later. It provides three strategies:

- **A — Shaped reserve:** render destination-specific, content-shaped reserved
  regions inside the stable app frame.
- **B — Named regions:** render destination landmarks and honest, calm loading
  copy instead of skeleton geometry.
- **C — Retained context:** keep the previous screen visible but inert while a
  compact destination-opening status floats above it.

Every strategy can be viewed for Today, People list, person detail, Review, and
Account at the `0–100 ms`, `Resolved`, and `Failure` moments. The floating arrows
or keyboard Left/Right keys switch strategies. Route and moment controls update
the URL, so a specific view is linkable.

## Run

From the repository root:

```bash
pnpm dev:web
```

Then open:

```text
http://localhost:3000/prototype/instant-shells?variant=A&surface=today&phase=shell
```

Accepted query values:

- `variant=A|B|C`
- `surface=today|list|detail|review|account`
- `phase=shell|complete|failure`

## Capture set

Variant A covers the full representative route matrix at desktop and mobile:

| Route | Desktop | Mobile |
| --- | --- | --- |
| Today | [0–100 ms](captures/a-today-desktop.png) | [0–100 ms](captures/a-today-mobile.png) |
| People list | [0–100 ms](captures/a-list-desktop.png) | [0–100 ms](captures/a-list-mobile.png) |
| Person detail | [0–100 ms](captures/a-detail-desktop.png) | [0–100 ms](captures/a-detail-mobile.png) |
| Review | [0–100 ms](captures/a-review-desktop.png) | [0–100 ms](captures/a-review-mobile.png) |
| Account | [0–100 ms](captures/a-account-desktop.png) | [0–100 ms](captures/a-account-mobile.png) |

Alternative-strategy and transition evidence:

- [Named Review regions, desktop](captures/b-review-desktop.png)
- [Named Review regions, mobile](captures/b-review-mobile.png)
- [Retained context opening person detail, desktop](captures/c-detail-desktop.png)
- [Retained context opening person detail, mobile](captures/c-detail-mobile.png)
- [Resolved Today, desktop](captures/a-today-resolved-desktop.png)
- [Failed Today, mobile](captures/a-today-failure-mobile.png)
- [Failed Account, desktop](captures/a-account-failure-desktop.png)

The capture set was rendered at 1440 × 960 desktop and 390 × 844 mobile
viewports. Browser capture completed without console errors.

## Feedback needed

Judge the transition contract, not the prototype controls:

1. Does a destination-specific shaped reserve feel calm and familiar, or merely
   blank?
2. Does naming a delayed region add useful honesty, or make a fast transition
   feel slower?
3. Is retained prior context reassuring, or does it make the destination
   ambiguous?
4. Should failure preserve the destination heading and stable navigation while
   only the failed region offers retry?

No prototype rendering code should be promoted. The validated contract belongs in
the shared Next.js 16.3 specification and ADRs.
