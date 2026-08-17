# Impeccable 4.0.2 licensing and provenance

Research supporting the Wayfinder decision ticket **Decide how vendored
third-party skill content is licensed or excluded**. Retrieved 2026-08-16.

## Verified provenance

- The two tracked Tendnote harness variants both identify themselves as
  `impeccable` version `4.0.2`; the Claude variant also declares
  `license: Apache 2.0` in its frontmatter. The variants serve different
  harnesses, rather than being redundant copies.
- Impeccable's official repository documents its CLI installer as the normal
  installation path and says it writes a build compiled for each detected
  harness. The relevant upstream project is
  [`pbakaus/impeccable`](https://github.com/pbakaus/impeccable).
- The official [`skill-v4.0.2` SKILL.md](https://raw.githubusercontent.com/pbakaus/impeccable/skill-v4.0.2/plugin/skills/impeccable/SKILL.md)
  declares `version: 4.0.2` and `license: Apache 2.0`.
- The official [`skill-v4.0.2` LICENSE](https://raw.githubusercontent.com/pbakaus/impeccable/skill-v4.0.2/LICENSE)
  is Apache License 2.0 and carries `Copyright 2025 Paul Bakaus`.

The repository history establishes that the bundles were added by a commit
called `Add impeccable skills`; it does not preserve the exact historical
installer command. The user confirms the official installer was used. Treat
the tagged upstream source above—not installer behavior alone—as the durable
provenance record.

## License facts

Apache License 2.0 section 4 requires a distributor to give recipients a copy
of the license, retain applicable source-form notices, and mark modified files
as changed. It requires a readable copy of upstream NOTICE content only when
the upstream Work includes a `NOTICE` text file. See the authoritative
[Apache License 2.0 text](https://www.apache.org/licenses/LICENSE-2.0).

Neither tracked Tendnote tree contains a `LICENSE`, `NOTICE`, or `COPYING`
file. The installer copying only the harness payload therefore plausibly
explains the gap, but does not transfer redistribution responsibility away
from Tendnote.

## Decision inputs

The agreed policy is to retain both harness variants and add a repository-level
Third-Party Attribution Bundle when implementation begins:

- `LICENSES/Apache-2.0.txt`, copied from the official upstream release;
- root `THIRD_PARTY_NOTICES.md`, with Impeccable's name, official source,
  `skill-v4.0.2` identifier, retrieval date, copyright/notice material, and
  the two vendored paths;
- a release-time recheck for upstream NOTICE content, copying any applicable
  NOTICE material into the attribution bundle; and
- the same source pin, compatibility, license, NOTICE, and exact-path record
  for every future redistributed third-party bundle.

This note records facts and the agreed planning direction; it does not itself
add the planned license or notice files.
