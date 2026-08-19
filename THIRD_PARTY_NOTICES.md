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
