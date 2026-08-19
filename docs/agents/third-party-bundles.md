# Third-party bundle publication gate

This is the maintainer checklist for any third-party source, skill, template,
or generated bundle that Tendnote redistributes. It is an operational release
gate, not legal advice or a counsel certification. Recheck the upstream release
at the time of each publication; do not rely on an old package install or on a
license field alone.

## Before adding a bundle

Record all of the following in `THIRD_PARTY_NOTICES.md` (or a linked notice
record) before committing the bundle:

1. **Source.** Name the upstream project and link to its official repository or
   release page. Pin an immutable release identifier such as a tag plus commit
   when the upstream publishes one.
2. **Compatibility.** Identify the license and confirm that redistribution and
   any intended modifications are compatible with Tendnote's AGPL-3.0-only
   outbound license. Escalate uncertainty instead of guessing.
3. **License text.** Copy the complete applicable license into `LICENSES/` and
   preserve the upstream copyright and attribution wording.
4. **NOTICE review.** Inspect the pinned upstream release for a `NOTICE` file
   and any required source-form notices. Preserve applicable NOTICE material in
   the repository attribution record; explicitly record when no NOTICE file is
   present. If the notice identifies nested third-party work, repeat this gate
   for that work and preserve its complete license and exact derived paths too.
5. **Provenance date.** Record the UTC retrieval or recheck date and the
   copyright holder(s) named by the upstream release.
6. **Exact tracked paths.** List every repository path that redistributes the
   bundle. Keep harness variants separate when they differ, and mark local
   modifications rather than presenting them as an unmodified upstream copy.

## Release and fresh-clone check

Run the publication check from a fresh clone at the candidate commit:

```bash
pnpm install --frozen-lockfile
pnpm publication:check
```

The check must identify the root outbound license, every current third-party
bundle, the complete license text, the applicable NOTICE result, and each exact
redistributed path. It must also reject maintainer-specific deployment values
in current configuration examples. Historical qualification records may retain
the IDs and account scopes that produced their evidence, but those records must
be labeled **Historical qualification evidence** and must not be copied into
current deployment configuration.

Do not publish a bundle when its source, release pin, compatibility, license,
NOTICE result, copyright, retrieval date, or exact location is unknown.
