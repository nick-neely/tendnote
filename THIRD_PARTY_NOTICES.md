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
- **License:** Apache License 2.0. The complete text is included at
  [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt), as required for
  redistribution.
- **Retrieved:** 2026-08-19.
- **Copyright:** `Copyright 2025 Paul Bakaus` (from the pinned upstream
  release's license and attribution material).
- **NOTICE review:** The pinned `skill-v4.0.2` release was checked for an
  upstream `NOTICE` file on 2026-08-19. No NOTICE file is present in that
  upstream release, so there is no additional upstream NOTICE text to copy.
  This result must be rechecked if the release pin changes.
- **Exact redistributed paths:**
  - [`.agents/skills/impeccable/`](.agents/skills/impeccable/)
  - [`.claude/skills/impeccable/`](.claude/skills/impeccable/)

The harness payloads are retained as source-form files. If either variant is
modified in a future change, the release record must state what changed and the
future-bundle gate in [`docs/agents/third-party-bundles.md`](docs/agents/third-party-bundles.md)
must be rerun against the pinned upstream source.
