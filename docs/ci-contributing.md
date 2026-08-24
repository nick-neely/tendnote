# Contributing to CI

This page is the small contributor-facing companion to
[`docs/local-development.md`](local-development.md). The contribution guide
links here without copying the workflow details.

## One verification path

Every push to a code pull request runs the whole verification set: **Quality**
(lint, typecheck, and the real-browser contracts), **Test and Fallow**
(coverage-backed tests, the CRAP check, and the Fallow audit), **Instant
matrix**, and **Database**. There is no label to apply and no tier to request,
so the result you see is always the result for the commit that would merge.
[ADR 0236](adr/0236-pull-request-verification-is-one-full-fidelity-path.md)
records why.

Each lane is required, and each is skipped when the change does not touch its
paths. A documentation-only pull request runs no verification lane at all and
still merges: GitHub reports a skipped job as a successful required check.

## Fork pull requests

Pull requests from forks run on GitHub-hosted `ubuntu-latest` runners. This is
intentional: untrusted fork code must not receive access to the private
RunsOn-backed runner network or its cache sidecar. GitHub may hold the first
workflow run for maintainer approval; a maintainer must approve it before the
workflow can execute. Fork jobs skip the RunsOn setup action and use the
GitHub-hosted cache path.

## RunsOn setup

Trusted-branch jobs use the repository's [RunsOn preset configuration](../.github/runs-on.yml),
which extends the same-owner private `.github-private` stack. The shared stack
defines the `light`, `default`, `big`, and `deploy` presets used by the
workflows; the repository does not carry cloud credentials or runner
infrastructure configuration.

`.github/runs-on.yml` is read from the default branch once the repository is
public, so the extension and any preset changes must land on `main` before
publication. Every trusted job starts with `runs-on/action@v2` to activate the
Magic Cache sidecar. Fork jobs deliberately take the `ubuntu-latest` fallback
instead.

`test_fallow` and `instant_matrix` keep `show_costs: summary`, because they are
the jobs whose runner shape is worth watching. This gives maintainers a visible
cost summary without turning routine job output into a cost trace. `quality`
also installs Chromium now, for the real-browser contracts, but it stays on the
`default` preset and carries no cost summary.
