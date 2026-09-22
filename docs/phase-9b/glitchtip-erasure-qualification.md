# Hosted GlitchTip account-erasure qualification

Workbook for [Qualify hosted GlitchTip's account-erasure contract](https://github.com/nick-neely/tendnote/issues/586).
Status: **awaiting the owner's provider inquiry.** No provider contact,
provisioning, purchase, or customer data transfer has occurred. The ticket
stays open until the provider's written answers are recorded below.

This is a human-in-the-loop task. Public documentation and source inspection
answer part of the question; the remaining commitments are hosted-service
facts only the operator, Burke Software and Consulting, can state. The owner
sends the inquiry; an agent must receive separate explicit authorization
before contacting the provider on Tendnote's behalf.

## What public evidence already establishes

Sources: [hosted architecture](https://glitchtip.com/documentation/hosted-architecture/),
[pricing FAQ](https://glitchtip.com/pricing), and the pinned backend
[maintenance module](https://gitlab.com/glitchtip/glitchtip-backend/-/blob/0299ab96b269070674f00ba43257d62b529fa1b1/apps/issue_events/maintenance.py).
Read on 2026-09-22.

- Issue deletion is accepted, marked, and queued; HTTP 204 is not completion.
  The queued routine raw-deletes the issue's events, hashes, tags, aggregates,
  comments, user reports, and index rows in batches. See the earlier
  [provider research](../research/phase-9b-hosted-telemetry-providers.md).
- The backend has a hot/cold split. When DuckDB is available, event
  partitions older than `GLITCHTIP_EVENT_HOT_DAYS` (default thirty days) are
  archived as Parquet files to S3-compatible cold storage, and cold files
  older than `GLITCHTIP_EVENT_RETENTION_DAYS` (default ninety days) are
  deleted by age. The issue-deletion routine does not rewrite or remove cold
  files. Whether the hosted US service runs this cold path, and what happens
  to an already-archived event when its issue is deleted, is not documented.
- Backups: "database snapshots are taken daily and retained for 7 days" for
  recovery-point purposes. Nothing is published about post-restore handling
  of previously deleted data, or whether cold-storage files are inside or
  outside the snapshot.
- The hosted service publishes a standard Data Processing Agreement covering
  GDPR, UK GDPR, and CCPA, offered as-is; paying customers can request a
  countersigned copy. Security and vendor-risk questions go to
  `support@glitchtip.com`. Breach notice to the customer's designated contact
  is promised within seventy-two hours of confirmation.
- Sub-processors are listed on the hosted-architecture page. Tendnote's
  sub-processor list must include GlitchTip and, transitively, its listed
  hosting and storage providers once adopted.

## Owner checklist

1. Send the inquiry below from the support address decided in
   [Decide the hosted privacy and customer-lifecycle obligations](https://github.com/nick-neely/tendnote/issues/570)
   to `support@glitchtip.com`. A paid Small plan is not required to ask; do
   not purchase anything for this step.
2. Paste the provider's reply verbatim into the evidence record below, with
   the date and the responder's name or role. Do not paraphrase.
3. If any answer is "it depends" or names a plan, capture the plan and the
   condition.
4. Ask for the DPA in its current published form and note its version and
   date. Request a countersigned copy only after a paid plan is approved.
5. Report the result on the ticket. If every item in the pass bar is met,
   the ticket resolves with the disclosure below filled in. If any item
   fails, the ticket resolves by returning the provider or identifier design
   to the owner in a new decision ticket; nothing is switched silently.

## Inquiry to send

Subject: Data-erasure questions for a hosted US plan (vendor risk assessment)

> Hello,
>
> I operate a small US consumer web service and am evaluating GlitchTip's
> hosted US region for error tracking. My privacy policy has to state
> exactly what happens when one of my customers deletes their account, so I
> need written answers to the questions below before subscribing. I will
> tag every event with an opaque account identifier and delete whole
> issues; individual-event deletion is not required.
>
> 1. Completion time. After the API accepts an issue deletion, what is the
>    maximum time until all of that issue's events, tags, aggregates,
>    hashes, comments, user reports, and search-index rows are removed from
>    live storage? Is that time committed anywhere, or best effort?
> 2. Cold storage. Does the hosted US service archive event partitions to
>    object storage (the DuckDB/Parquet cold path in the open-source
>    backend)? If so: when an issue is deleted, are its already-archived
>    events removed from the Parquet files, and within what maximum time?
>    Or do archived events persist until the age-based retention sweep?
> 3. Exhaustive matching. Is there a supported way to list every issue,
>    across the full retention window including archived events, that
>    contains a given tag value, and to confirm afterwards that no event
>    with that tag remains? Does the issue search cover cold storage?
> 4. Backups. You document daily database snapshots kept for seven days.
>    Are cold-storage files also in those snapshots? If a snapshot is
>    restored after a deletion, what prevents deleted events from returning
>    to active use, and is re-applying deletions part of your restore
>    procedure?
> 5. Surviving metadata. After an issue's deletion completes, or after
>    ninety-day expiry, what account-linked data can remain anywhere:
>    tag value indexes, issue titles or summaries, per-tag aggregates,
>    alert or notification history, logs, or analytics? How and when is it
>    deleted?
> 6. Is the published DPA the current version, and can you share a copy
>    with its date? Does it apply to the Small plan?
>
> Thank you,
> [name], Neely Solutions LLC

## Pass bar

The provider qualifies when the written answers give, for each row, a bounded
maximum and a mechanism. "Best effort" without a bound fails the row.

| Requirement | Pass condition |
| --- | --- |
| Live erasure completion | A stated maximum time from accepted deletion to removal of every listed row type |
| Archived events | Either no cold path in the hosted region, or deletion propagates to archives within a stated maximum |
| Exhaustive matching | A supported query that spans live and archived events by tag, plus a way to verify zero remaining matches |
| Backups | Seven-day expiry confirmed, cold-storage inclusion stated, and a restore procedure that does not resurrect deleted data or re-applies deletions |
| Surviving metadata | Every named residue either does not exist or has a stated deletion behavior and time |

If the cold-storage answer is that archives persist until age-based expiry,
that is a fail only if the owner declines to disclose it; the disclosure
below can honestly state a ninety-day archive tail. The owner decides which.

## Evidence record

Fill in after the reply arrives. Verbatim text, date, responder.

| Question | Verbatim answer | Date | Responder |
| --- | --- | --- | --- |
| 1 Completion time | | | |
| 2 Cold storage | | | |
| 3 Exhaustive matching | | | |
| 4 Backups | | | |
| 5 Surviving metadata | | | |
| 6 DPA version | | | |

## Proposed disclosure

Template for the privacy policy and the retention table in
[Hosted telemetry and data boundary](hosted-telemetry-and-data-boundary.md).
Brackets are filled from the evidence record; nothing in brackets may be
promised before it is answered.

> **Error reports.** We send technical error reports to GlitchTip, a hosted
> error-tracking service run by Burke Software and Consulting in the United
> States. Reports contain an internal account identifier and technical
> diagnostics, never your notes, names, or contact details. Live error
> reports are kept for ninety days. When you delete your account we stop
> sending reports immediately and delete every error report linked to your
> account; GlitchTip completes live deletion within [answer 1]. Reports
> older than thirty days may also sit in an archive, which [answer 2: is
> cleared within X / expires ninety days after the report was recorded].
> GlitchTip keeps encrypted backups for seven days; deleted reports leave
> those backups when they expire, and [answer 4] prevents restored backups
> from bringing deleted reports back.

Three tiers are stated separately on purpose: live deletion, archive
handling, and backup expiry. Do not collapse them into "deleted immediately".

## Out of this task

- Provisioning, payment, deployment, and sending any event.
- The outbound-payload test that proves the sanitized capture boundary;
  that belongs to implementation.
- Tendnote's own backup and recovery-window promises, handled in
  [Reconcile backup deletion and recovery-window promises](https://github.com/nick-neely/tendnote/issues/585).
