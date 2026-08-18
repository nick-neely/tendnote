# Contribution-governance research

> Factual input for **Decide the contribution governance instrument**. This is
> not a project decision or legal advice; counsel must review any eventual
> agreement.

Tendnote's settled publication input is that a CLA is collected from the first
external pull request so future relicensing permission is not reconstructed
after the fact ([ADR 0224](../adr/0224-tendnote-publishes-as-agpl-open-core.md)).
This note distinguishes the available instruments and their operational
properties; it does not reopen that input.

## CLA and DCO are different instruments

| | CLA | DCO |
| --- | --- | --- |
| Legal form | An agreement that can include explicit copyright and patent grants plus contributor representations. Apache's ICLA is a useful primary-source example, not a Tendnote template. | A per-contribution, individual certification that the contributor has the right to submit the work under the file's license. |
| License rights | A CLA can supply rights beyond the outbound project license, depending on its text. Apache's ICLA grants a copyright license and a patent license. | The Linux Foundation says the DCO is neither a contract nor a license grant; it is an assertion. Its usual model is “inbound equals outbound.” |
| Evidence | A signed agreement is stored against the contributor; a service can prompt again when the agreement version changes. | Each commit has a `Signed-off-by: Name <email>` trailer, normally produced by `git commit -s`. The sign-off becomes part of the public contribution record. |
| Consequence for this map | It can carry the explicit additional permission that the settled first-external-PR CLA requirement calls for, if that is what the eventual text says. | It cannot by itself add relicensing or other license rights, because the DCO does not grant a license. It may be an additional provenance check, but is not a substitute for a CLA that needs additional grants. |

Sources: [Apache ICLA](https://www.apache.org/licenses/icla.pdf) (copyright and patent grants; employer-rights representation), [Linux Foundation DCO guidance](https://bestpractices.linuxfoundation.org/ip/contribution-mechanisms-dco.html) (the DCO is not a contract or license grant), and [DCO 1.1](https://developercertificate.org/) (the canonical unmodifiable certification text).

## What tooling actually handles

### CLA Assistant

The maintained CLA Assistant project documents a GitHub-pull-request flow: it
comments on each newly opened pull request, authenticates the signer through
GitHub, lets that person agree in the pull request, updates the pull-request
status after agreement, remembers signed versions for repository owners, and
asks for a new signature on a later PR if the linked agreement changes. It can
also collect extra form fields. [CLA Assistant README](https://github.com/cla-assistant/cla-assistant#contributor-license-agreement-cla-assistant)

Its documented flow is for *each opened pull request*, not a documented
“first external PR only” mode. Thus a first-external boundary must be expressed
in the project policy/configuration and tested against the chosen hosted or
self-hosted implementation; the cited documentation does not establish that
the app distinguishes external from internal authors for Tendnote.

### DCO App

The maintained Probot DCO integration checks all non-bot, non-merge commits by
default. It blocks a PR until a signed-off revision is pushed, supports a
configured remediation commit, offers a recheck command, and exposes a
write-access override. It can exempt signed organization members, but that is
not a one-time external-contributor record: external contributors still sign
every applicable commit. [Probot DCO README](https://github.com/probot/dco#probot-dco)

The GitHub Marketplace listing independently states that the app fails the PR
status when a commit lacks a valid sign-off whose email matches the commit
author. [DCO GitHub App](https://github.com/apps/dco)

### Enforcement and a declined or abandoned agreement

Both integrations report a PR status; neither cited tool documentation says it
automatically declines or closes a pull request. A status becomes merge
enforcement only when the target branch requires it. GitHub documents that a
required check must pass before a collaborator can merge, and that the rule can
restrict the accepted check to the expected GitHub App. [GitHub protected-branch documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)

The remaining process question is therefore human/project policy, not a tool
feature: what standard response and closure rule applies when the contributor
does not sign, declines, or needs a corporate route. The DCO override is also a
separate authority decision; its presence means a project cannot describe DCO
as non-bypassable without configuring the surrounding GitHub rules and
maintainer practice.

## Individual and corporate contribution paths

- **Individual CLA.** Apache's exemplar has the person represent that they are
  legally entitled to grant the rights. If an employer has IP rights, the person
  represents permission, an employer waiver, or a separate corporate CLA.
  [Apache ICLA, section 4](https://www.apache.org/licenses/icla.pdf)
- **Corporate CLA.** Apache's corporate form is a distinct agreement executed
  by the corporation. It authorizes designated employees and grants copyright
  and patent licenses; the corporation must keep its authorized-employee list
  current. [Apache CCLA](https://www.apache.org/licenses/cla-corporate.pdf)
- **DCO.** The DCO is made by each *individual developer* at the time they
  contribute. It records that person's assertion of a right to submit; it has
  no corporate signer, employee roster, or separate corporate authorization
  mechanism. [Linux Foundation DCO guidance](https://bestpractices.linuxfoundation.org/ip/contribution-mechanisms-dco.html)

CLA Assistant can collect a field such as “I am signing on behalf of my
employer,” but a form selection is not the corporate agreement/authorized-user
record used by Apache's CCLA model. If Tendnote permits employer-owned work,
the eventual instrument needs an explicit corporate path and a maintained
mapping from company authorization to GitHub contributors; that is not supplied
by an individual click-through alone.

## A narrow, source-grounded AI provenance clause

The Linux Foundation permits AI-generated content, but says contributors should
ensure their tool terms are compatible with the project license and IP policy.
When pre-existing third-party material is in the output, the contributor should
confirm permission before submission and provide notice, attribution, and
applicable license information. [Linux Foundation Generative AI Policy](https://www.linuxfoundation.org/legal/generative-ai)

That supports a deliberately narrow candidate clause for counsel to adapt:

> AI-assisted Contributions are permitted. A Contributor represents that any
> generative-AI tool terms applicable to their Contribution permit submission
> under this project's license and contribution policy. If the Contributor is
> personally aware that AI output included in the Contribution contains
> pre-existing third-party material, the Contributor must, before submitting it,
> confirm permission to use, modify, and contribute that material and disclose
> its source, attribution, and applicable license or other restriction in the
> pull request.

The “personally aware” boundary follows Apache's treatment of third-party
restrictions known to the contributor. It avoids unverifiable claims about a
model's training data, a blanket ban on AI assistance, or a requirement to
disclose ordinary tool use where there is no known third-party-material issue.
Those omissions are intentional: the cited Linux Foundation policy requires
rights and notice for included third-party material, not a guarantee about all
model provenance. [Apache ICLA, section 5](https://www.apache.org/licenses/icla.pdf); [Linux Foundation Generative AI Policy](https://www.linuxfoundation.org/legal/generative-ai)

For optional, machine-readable provenance rather than another warranty,
Apache recommends a `Generated-by:` token in the commit message. Its guidance
describes that as a recommended practice for future tooling, not as a substitute
for the contributor's rights and third-party-material duties. [Apache Generative
Tooling Guidance](https://www.apache.org/legal/generative-tooling.html)
