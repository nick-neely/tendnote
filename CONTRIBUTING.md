# Contributing to Tendnote

Thanks for helping improve Tendnote. It is a consent-first, privacy-sensitive
personal system, so the contribution path keeps scope and evidence visible
without asking contributors to disclose private material.

## Before changing code

Start with the [README](README.md), then follow [local development](docs/local-development.md)
for prerequisites, setup, and commands. Read [the CI contribution notes](docs/ci-contributing.md)
for the verification tiers.

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
[verification labels](docs/ci-contributing.md#verification-labels), [CI
workflow requirements](docs/local-development.md#ci-workflows), and tracked
[default-branch ruleset](.github/rulesets/protect-main.json) for the exact
review and check expectations. Live default-branch protection and CLA Assistant
enforcement remain pending #473; this checkout does not claim current
protection or CLA enforcement.

## Contribution agreement and AI assistance

Read the [contribution-agreement status and path](docs/contributing.md) before
submitting external work. The intended publication gate requires a recorded
CLA Assistant acceptance before merge; an unsigned or declined external pull
request remains open but cannot merge. Employer-owned work uses the documented
corporate-authorization path rather than bypassing that gate.

AI-assisted contributions are permitted. You remain responsible for having the
right to submit the contribution and for disclosing any known pre-existing
third-party material, attribution, and applicable license or restriction. The
pull-request template has an optional public provider/model-and-role field and
an optional `Generated-by:` trailer. Do not include prompts, raw model outputs,
account information, or usage data.

The agreement and founder-to-Neely Solutions LLC rights chain are pending the
required private counsel and owner approvals; the status page is not a legal
instrument and this checkout does not claim live CLA enforcement.

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
