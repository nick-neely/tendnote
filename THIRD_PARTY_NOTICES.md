# Third-party notices

Tendnote is distributed under the [AGPL-3.0-only license](LICENSE). This file
records third-party source redistributed in the repository so a fresh clone can
identify its provenance, license, applicable notices, and exact locations.

## Impeccable harness variants

Tendnote redistributes two harness-specific variants of Impeccable. They are
not duplicate files: each is compiled for a different agent harness and both
remain part of the published source tree.

- **Project:** [pbakaus/impeccable](https://github.com/pbakaus/impeccable)
- **Release:** `skill-v4.0.2`
- **Pinned upstream files:** the release's
  [`plugin/skills/impeccable/SKILL.md`](https://raw.githubusercontent.com/pbakaus/impeccable/skill-v4.0.2/plugin/skills/impeccable/SKILL.md)
  identifies version `4.0.2` and Apache-2.0; the release
  [`LICENSE`](https://raw.githubusercontent.com/pbakaus/impeccable/skill-v4.0.2/LICENSE)
  is reproduced at [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).
- **Upstream NOTICE:** The pinned release contains
  [`NOTICE.md`](https://raw.githubusercontent.com/pbakaus/impeccable/skill-v4.0.2/NOTICE.md).
  Its complete text is preserved at
  [`LICENSES/Impeccable-NOTICE.md`](LICENSES/Impeccable-NOTICE.md).
- **License:** Apache License 2.0. The complete text is included at
  [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt), as required for
  redistribution.
- **Retrieved:** 2026-08-19.
- **Copyright:** `Copyright 2025 Paul Bakaus` (from the pinned upstream
  release's license and attribution material).
- **NOTICE review:** The pinned `skill-v4.0.2` release's `NOTICE.md` was
  retrieved and checked on 2026-08-19. The notice identifies content derived
  from [`ehmo/platform-design-skills`](https://github.com/ehmo/platform-design-skills),
  authored by `ehmo`. **Original license: MIT.** The complete cited MIT text is
  preserved at [`LICENSES/MIT.txt`](LICENSES/MIT.txt), retrieved from the
  cited upstream repository on 2026-08-19.
- **Exact redistributed paths:**
  - [`.agents/skills/impeccable/`](.agents/skills/impeccable/)
  - [`.claude/skills/impeccable/`](.claude/skills/impeccable/)
- **Exact paths containing the NOTICE-identified derived material:**
  - `.agents/skills/impeccable/reference/ios.md`
  - `.agents/skills/impeccable/reference/android.md`
  - `.claude/skills/impeccable/reference/ios.md`
  - `.claude/skills/impeccable/reference/android.md`

The harness payloads are retained as source-form files. If either variant is
modified in a future change, the release record must state what changed and the
future-bundle gate in [`docs/agents/third-party-bundles.md`](docs/agents/third-party-bundles.md)
must be rerun against the pinned upstream source.

## AI Elements (chat primitives)

Tendnote redistributes a subset of Vercel's AI Elements component registry as
source files under `apps/web/src/components/ai-elements/`. They are installed
with the shadcn CLI from the canonical registry
(`https://elements.ai-sdk.dev/api/registry/<name>.json`) and then adapted
locally; they are not an unmodified upstream copy.

- **Project:** [vercel/ai-elements](https://github.com/vercel/ai-elements)
  (published as the `ai-elements` npm package and the registry served from
  [elements.ai-sdk.dev](https://elements.ai-sdk.dev)).
- **Release:** the registry serves the `main` branch and publishes no per-file
  tag. Pinned to the `main` commit current at retrieval,
  [`6a9d5b1822ffb10bba4bd97175f01edd7d8651cd`](https://github.com/vercel/ai-elements/commit/6a9d5b1822ffb10bba4bd97175f01edd7d8651cd)
  (2026-08-21), alongside CLI package `ai-elements@1.9.0`, whose
  `package.json` declares `Apache-2.0`.
- **License:** Apache License 2.0. The complete text is included at
  [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt), as required for
  redistribution. The upstream
  [`LICENSE`](https://raw.githubusercontent.com/vercel/ai-elements/main/LICENSE)
  carries the header `Copyright 2023 Vercel, Inc.` above the Apache-2.0 grant.
- **Retrieved:** 2026-09-02 (registry pull and license recheck).
- **Copyright:** `Copyright 2023 Vercel, Inc.` (from the pinned upstream
  release's license file).
- **NOTICE review:** The pinned release contains no `NOTICE` or `NOTICE.md`
  file (checked 2026-09-02; both paths return 404). No nested third-party
  work is identified by the upstream license material. The components depend
  on separately installed npm packages (`streamdown`, `use-stick-to-bottom`,
  `radix-ui`, `nanoid`), which are ordinary dependencies, not redistributed
  source.
- **Exact redistributed paths** (all under
  [`apps/web/src/components/ai-elements/`](apps/web/src/components/ai-elements/)):
  `attachments.tsx`, `chain-of-thought.tsx`, `conversation.tsx`,
  `inline-citation.tsx`, `message.tsx`, `prompt-input.tsx`, `queue.tsx`,
  `reasoning.tsx`, `sources.tsx`, `suggestion.tsx`. The co-located
  `suggestion.dom.test.tsx` is Tendnote-authored.
- **Local modifications** (each file's header comment names its own):
  `lucide-react` icon imports rerouted to `@/components/icons`;
  `@radix-ui/react-use-controllable-state` imports rewritten to
  `radix-ui/internal`; Lucide-typed icon props widened to generic component
  types; `reasoning.tsx` renders Tendnote's `@/components/ui/shimmer` instead
  of the registry `shimmer` (which is not redistributed); `message.tsx` adds
  Streamdown plugins and Tendnote's user-bubble treatment; `conversation.tsx`
  adds `role="log"`; `prompt-input.tsx` imports Tendnote's `@/components/ui/*`
  primitives and carries a local restore-on-rejection composer contract;
  `inline-citation.tsx` lets `InlineCitationCardTrigger` render a caller's
  `children` in place of upstream's hostname label; biome formatting
  throughout.

If these files are re-pulled from the registry, re-run the future-bundle gate
in [`docs/agents/third-party-bundles.md`](docs/agents/third-party-bundles.md)
against the pinned upstream source and update the commit pin and retrieval
date here.

## shadcn/ui (carousel and sidebar primitives)

Tendnote redistributes a small set of shadcn/ui components as source files.
They are installed with the shadcn CLI — `carousel` as a registry dependency of
the AI Elements `inline-citation` component above, `sidebar` (with its own
registry dependencies `sheet`, `skeleton`, and the `use-mobile` hook) for the
Assistant page's conversation rail — and then adapted locally; they are not an
unmodified upstream copy.

- **Project:** [shadcn-ui/ui](https://github.com/shadcn-ui/ui).
- **Release:** the `ui.shadcn.com` registry serves the `main` branch and
  publishes no per-file tag. Pinned to the `main` branch current at retrieval,
  installed through CLI package `shadcn@4.19.0`.
- **License:** MIT. The complete text is included at
  [`LICENSES/MIT.txt`](LICENSES/MIT.txt), as required for redistribution.
- **Retrieved:** 2026-09-02.
- **Copyright:** `Copyright (c) 2023 shadcn`, from the upstream
  [`LICENSE.md`](https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md)
  retrieved and checked on 2026-09-02. The shared `LICENSES/MIT.txt` carries the
  MIT terms; this line is the copyright holder they are granted by.
- **NOTICE review:** The upstream repository contains no `NOTICE` or `NOTICE.md`
  file (checked 2026-09-02). No nested third-party work is identified by the
  upstream license material. The components depend on separately installed npm
  packages (`embla-carousel-react`, `radix-ui`, `class-variance-authority`),
  which are ordinary dependencies, not redistributed source.
- **Exact redistributed paths:**
  [`apps/web/src/components/ui/carousel.tsx`](apps/web/src/components/ui/carousel.tsx),
  [`apps/web/src/components/ui/sidebar.tsx`](apps/web/src/components/ui/sidebar.tsx),
  [`apps/web/src/components/ui/sheet.tsx`](apps/web/src/components/ui/sheet.tsx),
  [`apps/web/src/components/ui/skeleton.tsx`](apps/web/src/components/ui/skeleton.tsx),
  [`apps/web/src/hooks/use-mobile.ts`](apps/web/src/hooks/use-mobile.ts).
- **Local modifications** (each file's header comment names its own):
  `lucide-react` icon imports rerouted to `@/components/icons` in
  `carousel.tsx`, `sidebar.tsx`, and `sheet.tsx`; `sidebar.tsx` renders
  `data-active` only when a row is active, because React writes a `false` data
  attribute as the string `"false"` and Tailwind v4's `data-active:` variant
  matches on the attribute's presence; biome formatting throughout.
  `skeleton.tsx` and `use-mobile.ts` are unmodified apart from formatting.
  Two behaviours the registry leaves to the host are supplied from outside these
  files rather than by editing them: the sidebar's `--sidebar-*` palette is
  redefined in `apps/web/src/app/globals.css` in terms of Tendnote's own tokens,
  and the desktop container's whole-window `fixed inset-y-0 h-svh` geometry is
  offset by a `className` at the one call site that mounts it.

This record covers the files listed above. The other files under
`apps/web/src/components/ui/` predate this record and are not yet inventoried
here; adding them is tracked separately from these components.

If any of these files is re-pulled from the registry, re-run the future-bundle gate in
[`docs/agents/third-party-bundles.md`](docs/agents/third-party-bundles.md)
against the pinned upstream source and update the retrieval date here.
