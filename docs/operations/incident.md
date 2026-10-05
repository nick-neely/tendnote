# Runbook: Suspected Incident

From discovery to closure of a **Suspected Incident**
([the incident decision](../phase-9b/hosted-runbooks-and-tabletop.md#incident-runbook)).
The bar to open one is deliberately low: opening costs nothing, and deciding
late is the real risk. "Breach" is an output of the notification decision in
step 8, never a reason to open or not open.

## Trigger

Any suspicion of:

- unauthorized access to production, a provider account, or customer data;
- a leaked or misused credential, such as a secret in a log, a commit, a
  preview deployment, or a message;
- data crossing an outbound boundary, including customer content or
  identifiers reaching GlitchTip;
- a `failed` Deletion Record during a [restore](restore.md), or the alert
  "Backup surface does not match the Backup Window".

## Preconditions

1. The operations sheet is open. Every credential location below comes from it.
2. The incident log under **Incident log** is reachable. It is private and
   append-only, in a store whose credentials are separate from production.

## Steps

1. **Open the Incident Record now**, before investigating. Write the discovery
   time in UTC, how it was found, and what is suspected. Then compute and write
   both clocks from the discovery time:
   - **Individuals:** thirty calendar days.
   - **Regulator:** fourteen business days, to the strictest regulator
     (Vermont). Count Monday to Friday and skip observed holidays.

   From here, the log holds metadata only: row ids, counts, timestamps,
   provider log exports, and each decision with its reason. Never copy
   customer content into it. When scoping requires reading content in place,
   each read is its own log entry, naming the table and row ids and why.
2. **If scope is unknown, place the [Service-Wide Hold](service-wide-hold.md).**
   Place it first and investigate after. Note the `holdId` in the record.
3. **Post a [Service Notice](service-notice.md)**: content-free, naming no
   customer. Update it at least once a day while the incident affects
   customers.
4. **If anything may have crossed an outbound boundary to GlitchTip, disable
   capture.** In the web project's Vercel settings, delete `GLITCHTIP_DSN` from
   Production and redeploy. With no DSN, nothing is reported (ADR 0257). The
   [GlitchTip rotation](credential-rotation/glitchtip.md) covers the events
   already received.
5. **Rotate credentials** in the [order](README.md#credential-rotation), each by
   its own runbook. Rotate every provider whose credential may be exposed, and
   all of them when scope is unknown. [Sessions](credential-rotation/sessions.md)
   always comes last. Note each rotation's time in the record.
6. **Scope the incident** from provider logs and metadata: what was reachable,
   by whom, from when to when, and which accounts it touched. Export provider
   logs into the incident log. Write the affected account ids, or "all".
7. **Lift the hold** once containment is verified: every exposed credential is
   rotated and the access path is closed, as the rotation runbooks' provider
   checks show. Use the Service-Wide Hold runbook's lift, then run the
   rotation runbooks' checks that need the app to answer, and update the
   Service Notice.
8. **Decide notification**, after one consultation with counsel under
   **Counsel**. Notify customers whenever there is a reasonable belief that
   customer content or account data was acquired. Rely on no state
   risk-of-harm exemption. Write the decision and its reasons. If notice is not
   owed, go to step 11.
9. **Notify affected customers** by email, before the individuals' clock runs
   out, with the counsel-approved text. Read the recipients from production's
   database, scoped to the affected accounts:

   ```sql
   select email from "user" where id = any('{<account id>,<account id>}');
   ```

   Drop the `where` clause when every account is affected. Send from the
   support mailbox under **Support mailbox**, one message per recipient, never
   with other recipients visible. Notify each regulator counsel names, before
   the regulator clock runs out, using the routes under **Regulators**. Write
   the count sent and the time of each regulator notice in the record.
10. **Notify people without accounts only when counsel determines it is legally
    owed.** This is compelled notice, not a response to a request, so ADR 0247
    does not forbid it. Extract only email-address fields from the breached
    dataset, and read no content:

    ```sql
    select normalized_value as email from contact_methods
      where type = 'email' and normalized_value is not null
    union
    select normalized_email from household_invitations
    union
    select lower(recipient_email) from gmail_draft_actions
    except
    select lower(email) from "user";
    ```

    Scope each part to the breached accounts when scope is narrower: people
    through `people.owner_user_id`, invitations through their household's
    workspace (`household_id`), and drafts through `owner_user_id`. Keep the list
    only on the operator's machine for the send, then delete it. Send the
    counsel-approved notice as in step 9 and write only the count in the
    record.
11. **Close the record** when containment is verified, notification is done or
    decided against, and the Service Notice is cleared. Write the closure date.
    The record is kept for three years from it.

## Record produced

The Incident Record in the incident log, opened in step 1 before anything else.
It holds the discovery time, both clock deadlines, the Service-Wide Hold's
`holdId`, the time of each rotation, every content read, the scope, the
notification decision and its reasons, the notice counts and times, and the
closure date. It holds no customer content and no recipient list.

## Verification

- The record shows the customer notice sent before the individuals' deadline,
  and each regulator notice before the regulator deadline. Otherwise it shows
  a written decision that notice was not owed.
- Every credential the scope named shows a rotation time, and Sessions is the
  last.
- The status page shows no open notice for the incident, and the hold, if one
  was placed, is lifted.

## Rollback

None. An Incident Record is never deleted or rewritten. A suspicion that proves
unfounded is closed with that finding, which is the normal outcome of a low
bar. Each containment step has its own rollback in its runbook. A notice that
has gone out cannot be recalled. Correct it with a follow-up approved by
counsel.
