# Contribution Guide Contract

Wayfinder ticket [Decide whether Phase 9a needs a CONTRIBUTING guide](https://github.com/nick-neely/tendnote/issues/466) settles that the public repository needs a concise root `CONTRIBUTING.md`. It is a contributor's first-PR doorway, not a second README or a second governance manual.

## Purpose and boundary

The guide makes the contribution path legible to someone who has read the
README but has not worked in this repository. It must route a contributor to
the authoritative setup, verification, legal, security, and support materials
without copying their content or weakening their boundaries.

The guide does not add a platform-neutral self-hosting promise, a maintainer
support commitment, or a general security assurance. It also does not replace
the publication-time artifacts it links to.

## Required public path

The implemented guide must contain these short sections:

1. **Before changing code.** Point first-time contributors to the README and
   `docs/local-development.md` for prerequisites, local setup, and the
   applicable validation commands. Ask them to open an Issue before beginning
   a material feature, behavioral change, or architectural change so scope and
   privacy implications can be discussed. Small documentation corrections and
   self-contained test fixes may be proposed directly when their scope is
   clear.
2. **Pull requests.** Link the pull-request template and default-branch
   requirements. Ask for a focused change, the related issue where one exists,
   a concise explanation of user-visible and privacy-boundary impact, and the
   checks personally run. Do not duplicate the template's checklist.
3. **Contribution agreement.** Link the reviewed individual CLA and corporate
   authorization instructions. State that every external contribution needs a
   recorded CLA Assistant acceptance before merge; an unsigned or declined
   pull request remains open but cannot merge. Link the optional, public
   AI-assistance provenance field without requesting prompts, raw outputs,
   account data, or usage data.
4. **Security and sensitive data.** Route suspected vulnerabilities only to
   the private reporting path in root `SECURITY.md`; public Issues and pull
   requests must not contain credentials, private records, personal data, or
   exploit details. Link `docs/security.md` for the bounded product security
   posture rather than restating it.
5. **Support boundary.** State that Issues are open without an SLA and
   self-host support is community-only. Link the support policy when it exists;
   the guide must not imply managed support or a response-time commitment.

## Publication dependencies

`CONTRIBUTING.md` may be implemented with this exact public path only when its
links resolve to the real publication-time artifacts:

- `LICENSE` with the settled AGPL-3.0 text;
- the counsel-reviewed CLA and corporate authorization path;
- configured CLA Assistant enforcement and its required default-branch check;
- root `SECURITY.md` with GitHub Private Vulnerability Reporting; and
- the stated no-SLA, community-only support policy.

The publication implementation validates the guide from a fresh external
contributor's perspective: every link resolves, the pull-request template
matches the guide, the CLA gate prevents an unsigned external PR from merging,
and no public path invites disclosure of sensitive material.
