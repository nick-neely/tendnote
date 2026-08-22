# CLA Assistant enforcement runbook

This runbook is the operator-owned continuation of [issue #473](https://github.com/nick-neely/tendnote/issues/473).
The repository owns the exact Version 1.0 agreement, the hosted-service
metadata payload, the desired-state manifest, the expected ruleset shape, and
the redacted proof schema.
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
   cat .github/cla-assistant-desired-state.json
   ```

   The agreement hash must be
   `c3a8e1828d9d573dedba7ddb9e38fb043032532777db9e6028c4b99e4a5545ec` and the
   metadata hash must match `.github/cla-assistant-desired-state.json`.
3. Treat either `CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE` or
   `CLA_INTEGRATION_ID_TO_OBSERVE_LIVE` as an unsatisfied precondition. Neither
   placeholder is a live value and neither may be copied into a ruleset or
   proof. Until the hosted service emits an actual context and positive
   `integration_id` on a disposable pull request, the tracked ruleset must
   continue to require exactly `Verify`, `Full CI qualification`, and `Vercel`.

No step below authorizes accepting a CLA for another person, publishing a Gist,
installing an App, creating a test account, or changing live GitHub state from
an automated checkout.

## 1. Prepare the hosted CLA Assistant inputs

The hosted service is configured in the owner dashboard and through one
canonical linked agreement Gist. The desired-state manifest is documentation
for review; it is not a runtime file and does not configure a self-hosted
instance. The operator performs the hosted setup in the owner-controlled
GitHub account:

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
   `.github/cla-assistant-desired-state.json`. Stop if either differs.
5. Link the Gist to `nick-neely/tendnote` in the CLA Assistant dashboard. Use
   the hosted service's current GitHub App flow and requested permissions; do
   not substitute an unreviewed Action, DCO check, allowlist, or maintainer
   exception.

The linked agreement Gist is canonical: retain it as the dashboard's source of
truth, and do not create a second hosted agreement to stand in for it. The
dashboard's signer list and acceptance records are private operational records.
Never export or commit them. A pull request may expose only the minimum status
needed by the merge rule.

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

Record the exact context string and the positive `integration_id` returned for
that same CLA check (`check_run.app.id` when that is the GitHub API's field).
If either value is absent, if no CLA status appears, if the service reports
success before acceptance, or if the result cannot be tied to the disposable
pull request, stop and leave ruleset `19995472` unchanged.
Never replace either placeholder with `CLA Assistant`, `cla-assistant`,
`license/cla`, a guessed integration ID, or any other invented value.

The observed value is an input to the redacted proof schema, not a reason to
publish signer information. Preserve only a redacted case identifier,
timestamp, status, outcome, observed context, observed `integration_id`, and
the pinned agreement hash.

## 3. Safely add the observed context to ruleset 19995472

First save and inspect the live ruleset. The candidate must preserve every
existing rule and check, including the required contexts, strict status policy,
review-thread requirement, code-owner review, approval count, merge methods,
deletion rule, and non-fast-forward rule. It must remove the existing
`RepositoryRole` bypass actor so an unsigned pull request cannot bypass the
CLA check; the final candidate must have `bypass_actors = []`. Do not use a
broad replacement payload assembled from memory.

```sh
set -eu
umask 077
CLA_WORKDIR="$(mktemp -d)"
chmod 700 "$CLA_WORKDIR"
trap 'rm -rf -- "$CLA_WORKDIR"' EXIT

gh api repos/nick-neely/tendnote/rulesets/19995472 > "$CLA_WORKDIR/ruleset.before.json"
```

Set `CLA_STATUS_CONTEXT` only to the context observed in step 2. Refuse an
empty value or the repository placeholder:

```sh
test -n "${CLA_STATUS_CONTEXT:-}"
test "$CLA_STATUS_CONTEXT" != "CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE"
case "${CLA_INTEGRATION_ID:-}" in
  (""|*[!0-9]*) echo "missing or invalid CLA_INTEGRATION_ID" >&2; exit 1 ;;
esac
test "$CLA_INTEGRATION_ID" -gt 0
test "$CLA_INTEGRATION_ID" != "CLA_INTEGRATION_ID_TO_OBSERVE_LIVE"
```

Build a candidate from the live response, append one required check pinned to
the observed integration ID, remove only the repository-role bypass actor, and
assert that all old checks remain before sending anything. The API shape can
change, so inspect the candidate and compare it with the saved response before
the owner authorizes the full replacement PUT:

```sh
jq --arg context "$CLA_STATUS_CONTEXT" --argjson integration_id "$CLA_INTEGRATION_ID" '
  ([.rules[] | select(.type == "required_status_checks")] | length) as $status_rule_count
  | if $status_rule_count != 1 then error("expected one required-status rule; stop")
    else
      (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks) as $existing
      | if (($existing | map(.context) | sort) != (["Full CI qualification", "Vercel", "Verify"] | sort))
        then error("existing required contexts changed; stop")
        elif ($existing | any(.[]; .context == $context))
        then error("CLA context already exists; stop")
        else
          .rules |= map(
            if .type == "required_status_checks"
            then .parameters.required_status_checks += [{"context": $context, "integration_id": $integration_id}]
            else .
            end
          )
          | .bypass_actors = []
        end
    end
' "$CLA_WORKDIR/ruleset.before.json" > "$CLA_WORKDIR/ruleset.candidate.json"

jq -e --arg context "$CLA_STATUS_CONTEXT" --argjson integration_id "$CLA_INTEGRATION_ID" \
  --slurpfile before "$CLA_WORKDIR/ruleset.before.json" '
  ($before[0]) as $before
  | ([.rules[] | select(.type != "required_status_checks")]) as $candidate_non_status
  | ([$before.rules[] | select(.type != "required_status_checks")]) as $before_non_status
  | ([.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks] | add) as $candidate_checks
  | ([$before.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks] | add) as $before_checks
  | ($candidate_checks | map(select(.context != $context))) as $candidate_checks_without_cla
  | ($candidate_checks | any(.[]; .context == $context and .integration_id == $integration_id)) as $has_observed_cla
  | ($candidate_non_status == $before_non_status)
    and ($candidate_checks_without_cla == $before_checks)
    and $has_observed_cla
    and (.bypass_actors == [])
' "$CLA_WORKDIR/ruleset.candidate.json"
```

Only after human inspection and explicit owner authorization may the operator
apply the candidate through the GitHub API. Strip read-only response fields so
the update payload contains the same rule shape the API accepts:

```sh
jq '{name, target, enforcement, conditions, rules, bypass_actors}' \
  "$CLA_WORKDIR/ruleset.candidate.json" \
  > "$CLA_WORKDIR/ruleset.payload.json"
# OWNER AUTHORIZATION REQUIRED: the next command mutates live ruleset state.
gh api --method PUT repos/nick-neely/tendnote/rulesets/19995472 \
  --input "$CLA_WORKDIR/ruleset.payload.json" \
  > "$CLA_WORKDIR/ruleset.after.json"
gh api repos/nick-neely/tendnote/rulesets/19995472 > "$CLA_WORKDIR/ruleset.after-requery.json"

jq -e --arg context "$CLA_STATUS_CONTEXT" --argjson integration_id "$CLA_INTEGRATION_ID" '
  ([.rules[] | select(.type == "required_status_checks")]
    | map(.parameters.required_status_checks) | add) as $checks
  | ($checks | map(.context) | sort) as $contexts
  | ($checks | any(.[]; .context == $context and .integration_id == $integration_id)) as $has_observed_cla
  | ($contexts == (["Full CI qualification", "Vercel", "Verify", $context] | sort))
    and $has_observed_cla
    and (.bypass_actors == [])
' "$CLA_WORKDIR/ruleset.after-requery.json"
```

Preserve the live response and verify the resulting rule immediately. The
post-update response must contain the observed context with the same positive
`integration_id`, every existing rule/check, and `bypass_actors = []`. If any
existing rule or context is missing, stop and ask the owner to restore the
prior authorized payload; never “fix” a mismatch by weakening protection.

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
signer exports, or agreement records. The proof schema requires exactly one
unsigned, accepted, employer, and corporate case; it rejects duplicate kinds,
contradictory status/outcome pairs, unobserved integration IDs, and an
agreement hash other than the approved Version 1.0 bytes.

## 5. Preserve evidence and clean up

Store the redacted proof beside the exact candidate commit only after all four
cases and the post-update ruleset response are available. Validate the
agreement hash, ruleset ID, exact observed context, four outcomes, and the
redaction flags. A missing or non-redacted field blocks publication.

After preserving the redacted evidence, the `trap` removes only the local
disposable files under `CLA_WORKDIR`:

1. Close each disposable pull request without merging it.
2. Delete disposable branches and remove temporary collaborator access.
3. Delete or archive only disposable test Gists, if any. Retain the canonical
   linked agreement Gist in the CLA Assistant dashboard and do not delete or unlink the canonical
   agreement Gist; it is the source of truth for the
   pinned agreement hash. Keep private acceptance records under the owner's
   records policy.
4. Re-query ruleset `19995472` and verify that the observed CLA context and
   its integration ID remain required
   alongside `Verify`, `Full CI qualification`, and `Vercel`.
5. Do not remove the CLA requirement, add an allowlist, restore a repository
   role bypass, or claim live qualification if any case was skipped, accepted
   by an operator, or recorded with private data.

The repository is not live-proof qualified until the owner has completed these
identity-bound steps and attached the redacted, schema-valid evidence to the
publication review. This runbook itself is not evidence of a hosted result.
