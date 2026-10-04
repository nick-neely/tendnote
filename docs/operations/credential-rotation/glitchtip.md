# Runbook: rotate GlitchTip credentials

Sixth in the [rotation order](../README.md#credential-rotation). GlitchTip
receives error reports through the project DSN (`GLITCHTIP_DSN`), built by hand
with no SDK
([ADR 0257](../../adr/0257-glitchtip-reports-are-built-by-hand-with-no-sdk.md)).
With no DSN set, nothing is sent. The organization, the project, and the
account are under **GlitchTip** in the operations sheet.

## Trigger

- An [incident](../incident.md) whose scope includes the DSN or the GlitchTip
  account, or whose scope is unknown.
- Customer content or identifiers found in a GlitchTip event: an outbound
  boundary breach.

## Preconditions

1. The Incident Record is open, and Vercel is already rotated.
2. Capture is already disabled when a boundary breach is suspected: the
   incident runbook removes `GLITCHTIP_DSN` from Production first.
3. The operator can sign in to GlitchTip with two-factor authentication.

## Steps

1. **Close account access.** Change the GlitchTip account password, remove
   any API token that may be exposed, and remove any organization member who
   should not be there.
2. **Replace the DSN.** In the project's **Client Keys (DSN)** settings,
   create a new key and delete the old one. A request with the old DSN is
   then refused.
3. **Remove events that crossed the boundary.** For a boundary breach, find
   each event that carries customer content or an identifier. Record its
   event id, time, and the kind of field in the incident log, never its
   value. Then delete the issue holding it. Find out which code path built it
   and fix that before step 4.
4. **Re-enable capture** only when the code path is fixed and deployed, or when
   no boundary breach was suspected. Set the new DSN as `GLITCHTIP_DSN` in
   Production on the web project, and redeploy.

## Record produced

The Incident Record gets the time of each step, the deleted events' ids and
field kinds, and the fix that closed the path. It never gets a DSN or an
event's content.

## Verification

1. The deleted issues are gone from the project.
2. After step 4, an error from a signed-in, eligible account appears in the
   project as a new event, built from the envelope's fields only.
3. A report sent with the old DSN is refused.

## Rollback

Delete `GLITCHTIP_DSN` from Production and redeploy to stop capture again.
Deleted events cannot be restored, and an exposed DSN must not return.
