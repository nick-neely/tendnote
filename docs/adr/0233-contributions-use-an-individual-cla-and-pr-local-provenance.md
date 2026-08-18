# Contributions Use An Individual CLA And PR-Local Provenance

ADR 0224 requires a Contributor License Agreement (CLA) from the first
external pull request because the AGPL license alone does not preserve consent
for a future commercial exception or relicensing. A Developer Certificate of
Origin would document an individual assertion, but it is neither a contract
nor an additional license grant. The project also needs an honest boundary for
AI-assisted work that asks contributors to stand behind rights they actually
know, rather than asserting impossible provenance over model training data.

## Decision

Tendnote will use a counsel-reviewed, Apache ICLA-derived individual CLA. It
will grant Neely Solutions LLC the copyright and patent permissions needed to
distribute the accepted Contribution under Tendnote's licenses without taking
copyright ownership from the contributor. Every external contributor must
accept it before their contribution merges. Where an employer owns the work,
the individual agreement is supplemented by documented employer authorization
or a corporate CLA before merge. Separately, the founding author will execute a
private IP assignment or confirmation to Neely Solutions LLC before
publication; Git authorship is not a substitute for that record.

The hosted CLA Assistant GitHub App is the normal signing and evidence path.
Its status check is required by the default-branch ruleset and must be tested
on a disposable external-contributor pull request before publication. A
signature is collected and retained against the contributor's first external
pull request; an unsigned or declined pull request stays open but cannot merge.
There is no automatic closure or undocumented maintainer bypass for an
external contribution. A corporate contribution follows the documented
authorization path rather than bypassing the gate.

AI-assisted Contributions are permitted. The agreement requires a contributor
to ensure applicable tool terms allow their submission and to disclose known
pre-existing third-party material, attribution, and license or other
restrictions before submitting it. The pull-request template will offer a
non-required, public `AI assistance` field for the provider/model and its role
in the work; an omitted field makes no assertion that AI was not used. It must
not request prompts, raw outputs, account information, or usage data. A
`Generated-by:` commit trailer is permitted as optional, machine-readable
provenance.

## Consequences

The publication slice must add the reviewed CLA, corporate-authorization
instructions, CLA Assistant configuration, a required ruleset check, and the
optional pull-request-template field. It must state the unsigned-PR behavior
where contributors will encounter it and prove the gate cannot be silently
merged around. The agreement's legal text and the founder-to-LLC instrument
need legal review; this ADR settles the product's governance and operational
shape, not legal advice.
