# Contributing to Tendnote

Thanks for helping improve Tendnote. It is a consent-first, privacy-sensitive
personal system, so the contribution path keeps scope and evidence visible
without asking contributors to disclose private material.

## Before changing code

Start with the [README](README.md), then follow [local development](docs/local-development.md)
for prerequisites, setup, and commands. Read [the CI contribution notes](docs/ci-contributing.md)
for what pull-request verification runs.

Open an Issue before starting material behavior, architecture, or privacy work.
Small documentation corrections and clearly self-contained test fixes may go
directly to a pull request.

For any public report or example, use synthetic fixtures and minimized
reproductions. Never include credentials, private records, personal data, or
exploit details in a public Issue or pull request.

## Pull requests

Use the [pull-request template](.github/pull_request_template.md). Keep the
change focused, link the related Issue when one exists, describe user-visible
and privacy-boundary impact, and list the checks you personally ran. See the
[one verification path](docs/ci-contributing.md#one-verification-path), [CI
workflow requirements](docs/local-development.md#ci-workflows), and tracked
[default-branch ruleset](.github/rulesets/protect-main.json) for the exact
review and check expectations. The repository-owned [CLA Assistant desired-state manifest](.github/cla-assistant-desired-state.json),
[metadata](docs/legal/cla-assistant-metadata.json), [redacted proof schema](docs/phase-9a/cla-gate-proof.schema.json),
and [operator runbook](docs/phase-9a/cla-enforcement-runbook.md) are prepared.
Hosted activation, observation of the actual CLA status context, live ruleset
update, and disposable proof remain owner-gated work in #473; this checkout
does not claim current CLA enforcement or live proof.

## Contribution agreement and AI assistance

Read the [contribution-agreement status and path](docs/contributing.md) and the
[agreement packet](docs/legal/README.md) before submitting external work. The
packet links the [individual ICLA](docs/legal/individual-contributor-license-agreement.md),
[employer authorization](docs/legal/employer-contribution-authorization.md),
and [corporate CLA](docs/legal/corporate-contributor-license-agreement.md)
forms. The agreement packet is counsel-reviewed and owner-approved; Version 1.0 is
effective 2026-08-21. Once the approved process is configured, the intended
publication gate requires a recorded CLA Assistant acceptance before merge; an
unsigned or declined external pull request remains open but cannot merge.
Employer-owned work uses the documented authorization path rather than
bypassing that gate.

AI-assisted contributions are permitted. You remain responsible for having the
right to submit the contribution and for disclosing any known pre-existing
third-party material, attribution, and applicable license or restriction. The
pull-request template has an optional public provider/model-and-role field and
an optional `Generated-by:` trailer. Do not include prompts, raw model outputs,
account information, or usage data.

The agreement packet is counsel-reviewed and owner-approved; Version 1.0 is effective
2026-08-21. The private founder-to-Neely Solutions LLC rights assignment or
confirmation is **owner-confirmed as executed**, but this page does not claim
that counsel has verified that private instrument. The status page is not a
legal instrument, and this checkout does not claim live CLA enforcement.

## Security and sensitive data

Report suspected vulnerabilities only through [GitHub Private Vulnerability
Reporting](SECURITY.md). Do not put credentials, private records, personal
data, or exploit details in public Issues or pull requests. The
[Security and Privacy document](docs/security.md) is the detailed, bounded
product-security reference.

## Support boundary

Read the [community support policy](docs/support.md): Issues are open with no
service-level agreement, and self-hosting support is community-only. Tendnote
does not provide managed self-host support or a response-time commitment.
