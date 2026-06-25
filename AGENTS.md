# AGENTS.md

## Product guardrails

- Tendnote is not a sales CRM. Avoid pipeline, deal, lead-scoring, or autonomous outreach framing.
- External sends and external draft creation require explicit approval.
- Do not add Gmail, Calendar, Contacts, or shared household behavior before the relevant phase has code-level privacy and approval boundaries.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with default label names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Domain modeling docs are created lazily when terms or decisions need to be resolved. See `docs/agents/domain.md`.

## Learned User Preferences

- Keep `AGENTS.md` minimal: only document constraints agents routinely get wrong; omit trivia and anything discoverable by searching the codebase.
