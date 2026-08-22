# CLA Assistant enforcement runbook

This runbook is the operator-owned continuation of [issue #473](https://github.com/nick-neely/tendnote/issues/473).
The repository owns the exact Version 1.0 agreement, the hosted-service
metadata payload, the expected ruleset shape, and the redacted proof schema.
The hosted CLA Assistant account, Gist, GitHub App installation, external test
accounts, signatures, and live ruleset are identity-bound operations. They are
not performed by an agent or by this checkout.

## Preconditions and fail-closed boundary

Before any live operation, the operator must:

1. Have authority over `nick-neely/tendnote`, its default branch, and the
   hosted CLA Assistant account.
2. Use a clean checkout of the candidate commit and verify the tracked inputs:

   ```sh
   git diff --check
   sha256sum docs/legal/individual-contributor-license-agreement.md
   sha256sum docs/legal/cla-assistant-metadata.json
   cat .github/cla-assistant.json
   ```

   The agreement hash must be
   `c3a8e1828d9d573dedba7ddb9e38fb043032532777db9e6028c4b99e4a5545ec` and the
   metadata hash must match `.github/cla-assistant.json`.
3. Treat `CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE` as an unsatisfied precondition.
   It is not a status context and must never be copied into a live ruleset.
   Until the hosted service emits an actual context on a disposable pull
   request, the tracked ruleset must continue to require exactly `Verify`,
   `Full CI qualification`, and `Vercel`.

No step below authorizes accepting a CLA for another person, publishing a Gist,
installing an App, creating a test account, or changing live GitHub state from
an automated checkout.

## 1. Prepare the hosted CLA Assistant inputs

The hosted service documents a Gist containing the agreement and, optionally,
a second file named exactly `metadata`. The operator performs this in the
owner-controlled GitHub account:

1. Open [CLA Assistant](https://cla-assistant.io/) and authenticate as the
   repository owner.
2. Create a private or otherwise owner-controlled Gist with a file named
   `individual-contributor-license-agreement.md`. Paste the bytes of
   `docs/legal/individual-contributor-license-agreement.md`; do not edit
   whitespace, headings, the effective date, or the version.
3. Add a file named `metadata` containing the exact JSON bytes of
   `docs/legal/cla-assistant-metadata.json`. The only collected custom field is
   the non-sensitive rights route. Do not add legal names, addresses, contact
   details, signatures, employer details, account identifiers, prompts, model
   output, or usage data as custom fields.
4. Recompute both hashes from the Gist's raw file contents and compare them to
   `.github/cla-assistant.json`. Stop if either differs.
5. Link the Gist to `nick-neely/tendnote` in the CLA Assistant dashboard. Use
   the hosted service's current GitHub App flow and requested permissions; do
   not substitute an unreviewed Action, DCO check, allowlist, or maintainer
   exception.

The dashboard's signer list and acceptance records are private operational
records. Never export or commit them. A pull request may expose only the
minimum status needed by the merge rule.

## 2. Observe the real status context before enforcement

Use a disposable external-contributor account and a disposable branch. Open a
minimal pull request that contains no private data and do not accept the
agreement. Wait for the hosted service to comment and report its check, then
observe the actual context rather than guessing its display name:

```sh
gh pr checks <unsigned-pr-number> --repo nick-neely/tendnote
gh api repos/nick-neely/tendnote/commits/<unsigned-head-sha>/check-runs --paginate
gh api repos/nick-neely/tendnote/commits/<unsigned-head-sha>/status --paginate
```

Record the exact context string and, when supplied by GitHub, its integration
identifier. If no CLA status appears, if the service reports success before
acceptance, or if the result cannot be tied to the disposable pull request,
stop and leave ruleset `19995472` unchanged. Never replace the placeholder with
`CLA Assistant`, `cla-assistant`, `license/cla`, or any other guessed value.

The observed value is an input to the redacted proof schema, not a reason to
publish signer information. Preserve only a redacted case identifier,
timestamp, status, outcome, observed context, and the agreement hash.

## 3. Safely add the observed context to ruleset 19995472

First save and inspect the live ruleset. The candidate must preserve the
existing required contexts, strict status policy, review-thread requirement,
code-owner review, approval count, merge methods, deletion rule,
non-fast-forward rule, and existing bypass actor exactly. Do not use a broad
replacement payload assembled from memory.

```sh
gh api repos/nick-neely/tendnote/rulesets/19995472 > /tmp/tendnote-ruleset-19995472.before.json
```

Set `CLA_STATUS_CONTEXT` only to the context observed in step 2. Refuse an
empty value or the repository placeholder:

```sh
test -n "${CLA_STATUS_CONTEXT:-}"
test "$CLA_STATUS_CONTEXT" != "CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE"
```

Build a candidate from the live response, append one required check, and
assert that the old checks remain before sending anything. The API shape can
change, so inspect the candidate and compare it with the saved response before
the owner authorizes the PUT:

```sh
jq --arg context "$CLA_STATUS_CONTEXT" '
  (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks)
  as $existing
  | if (($existing | map(.context) | sort) != (["Full CI qualification", "Vercel", "Verify"] | sort))
    then error("existing required contexts changed; stop")
    elif ($existing | any(.context == $context))
    then .
    else (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks) += [{"context": $context}]
    end
' /tmp/tendnote-ruleset-19995472.before.json > /tmp/tendnote-ruleset-19995472.candidate.json
jq -e '
  (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks
    | map(.context) | index("Verify")) != null and
  (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks
    | map(.context) | index("Full CI qualification")) != null and
  (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks
    | map(.context) | index("Vercel")) != null
' /tmp/tendnote-ruleset-19995472.candidate.json
```

Only after human inspection and explicit owner authorization may the operator
apply the candidate through the GitHub API. Strip read-only response fields so
the update payload contains the same rule shape the API accepts:

```sh
jq '{name, target, enforcement, conditions, rules, bypass_actors}' \
  /tmp/tendnote-ruleset-19995472.candidate.json \
  > /tmp/tendnote-ruleset-19995472.payload.json
# OWNER AUTHORIZATION REQUIRED: the next command mutates live ruleset state.
gh api --method PUT repos/nick-neely/tendnote/rulesets/19995472 \
  --input /tmp/tendnote-ruleset-19995472.payload.json \
  > /tmp/tendnote-ruleset-19995472.after.json
gh api repos/nick-neely/tendnote/rulesets/19995472
```

Preserve the live response and verify the resulting rule immediately. If any
existing rule or context is missing, restore the prior authorized payload and
stop; never “fix” a mismatch by weakening protection.

## 4. Run the disposable proof cases

Use separate disposable pull requests and the same observed context for every
case. Keep each change synthetic and tiny. The expected outcomes are:

| Case | Required private route | Expected public result |
| --- | --- | --- |
| unsigned | no acceptance or authority record | CLA status fails or remains pending; PR stays open and unmergeable |
| accepted | individual Version 1.0 acceptance | CLA status succeeds; other required checks still govern merge |
| employer | individual acceptance plus the signed Version 1.0 employer authorization for the named scope | the same required CLA status succeeds; no bypass |
| corporate | signed Version 1.0 corporate agreement plus the private authorized-contributor schedule (and individual acceptance where the route requires it) | the same required CLA status succeeds; no bypass |

An employer or corporate selection in the metadata is only a route label. It
does not itself grant rights, authorize an account, or waive the required CLA
status. Keep all legal forms, schedules, contact details, and acceptance data
in the owner-controlled private record. Do not accept or sign any agreement on
behalf of a contributor or entity.

For each case, write only an object accepted by
[`cla-gate-proof.schema.json`](cla-gate-proof.schema.json). The `proofId`,
identity, pull-request reference, and Gist reference must be redacted. The
proof must not include names, email addresses, account IDs, raw comments,
signer exports, or agreement records.

## 5. Preserve evidence and clean up

Store the redacted proof beside the exact candidate commit only after all four
cases and the post-update ruleset response are available. Validate the
agreement hash, ruleset ID, exact observed context, four outcomes, and the
redaction flags. A missing or non-redacted field blocks publication.

After preserving the redacted evidence:

1. Close each disposable pull request without merging it.
2. Delete disposable branches and remove temporary collaborator access.
3. Remove or archive the temporary Gist only according to the owner's records
   policy; retain the approved agreement version and private acceptance records
   needed to administer future contributions.
4. Re-query ruleset `19995472` and verify that the observed CLA context remains
   required alongside `Verify`, `Full CI qualification`, and `Vercel`.
5. Do not remove the CLA requirement, add an allowlist, use the existing
   maintainer bypass, or claim live qualification if any case was skipped,
   accepted by an operator, or recorded with private data.

The repository is not live-proof qualified until the owner has completed these
identity-bound steps and attached the redacted, schema-valid evidence to the
publication review. This runbook itself is not evidence of a hosted result.
