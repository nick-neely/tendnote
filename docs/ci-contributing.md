# Contributing to CI

This page is the small contributor-facing companion to
[`docs/local-development.md`](local-development.md). The future contribution
guide from #472 can link here without copying the workflow details.

## Verification labels

Code pull requests need the `full-ci` label before they can satisfy the
required **Full CI qualification** check. Applying the label runs the
coverage-backed Test and Fallow, browser, Instant, and database lanes for the
exact pull-request commit. The check remains **Qualification pending** until
that label event succeeds.

Apply `full-ci` only after the final code commit is pushed. A later commit
keeps the ordinary `Verify` check current but invalidates the exact-SHA full
qualification, so remove and reapply `full-ci` on the final commit. A
documentation-only change is qualified automatically and does not run the
expensive verification lanes.

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

The three deliberately expensive jobs keep `show_costs: summary`: `fast_tests`,
`test_fallow`, and `instant_matrix`. This gives maintainers a visible cost
summary without turning routine job output into a cost trace.
