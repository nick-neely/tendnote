# Runbook: rotate AI Gateway credentials

Fifth in the [rotation order](../README.md#credential-rotation). Every model
call goes through the Vercel AI Gateway. A deployment authenticates to it with
its Vercel OIDC token, which is short-lived and rotates on its own, or with an
`AI_GATEWAY_API_KEY` where one is set. The key's name and the projects that use
it are under **AI Gateway** in the operations sheet.

## Trigger

An [incident](../incident.md) whose scope includes a gateway key or the
gateway's spend, or whose scope is unknown.

## Preconditions

1. The Incident Record is open, and Vercel is already rotated. Closing the
   Vercel account closed the dashboard path to the gateway.
2. The list of projects with `AI_GATEWAY_API_KEY` set, from the projects'
   environment. If no project sets it, there is no key to rotate. Skip to
   step 3.

## Steps

1. **Replace the key.** Create a new key with
   `vercel ai-gateway api-keys create --name <name>`, set it as
   `AI_GATEWAY_API_KEY` in Production on each project from precondition 2, and
   redeploy them.
2. **Delete the old key** and any other key that may be exposed, in the
   gateway's **API Keys** page in the Vercel dashboard.
3. **Check for misuse.** In the gateway's usage view, check the incident window
   for spend or models the product does not use. Export the figures into the
   incident log. A Spend Breaker trip in the window is also a sign.

## Record produced

The Incident Record gets the time of each step, the key names deleted, and the
usage findings. It never gets a key.

## Verification

1. An Eve turn in the web chat completes.
2. `pnpm --filter @tendnote/web first-value-check` prints `"failed": []`. Its
   model step calls the gateway.
3. The gateway's **API Keys** page lists no deleted key.

## Rollback

None: an exposed key must not return. A key set wrong is fixed by setting the
right value and redeploying.
