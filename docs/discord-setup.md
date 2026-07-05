# Discord Setup

> **Human-in-the-loop setup.** This guide configures a Discord application,
> Tendnote environment variables, slash commands, and smoke checks for the
> Private Capture Channel. Discord Developer Portal steps cannot be completed by
> an agent or by code; an operator with access to the Discord application must
> run them.

Tendnote uses Discord as its first non-web **Private Capture Channel**
(ADR-0122). Discord is a channel, not a generic Eve connection. It is used for
owner-scoped quick capture, HITL clarification/review, and explicitly configured
proactive delivery targets.

In production, a Tendnote user connects Discord through **Better Auth's Discord
provider** (account linking, not sign-in) from the account settings page
(ADR-0138). That link — not a hand-edited env map — is what establishes the
Tendnote owner an inbound Discord interaction resolves to. The manual
`DISCORD_OWNER_USER_MAP` env variable remains only as a **dev / private-beta
fallback** and is ignored in production (see [§5](#5-owner-resolution-order)).

Do **not** use Discord as a file import path. Current Eve Discord channel support
does not include inbound attachments, so Cleanup Preview input should stay in the
web app plus sandbox workflow.

---

## Concepts: four distinct pieces of Discord state

These are deliberately separate concerns. Conflating them is the most common
setup mistake, so map them before configuring anything.

| Piece | Backed by | Scope / key | Answers |
| --- | --- | --- | --- |
| **Interaction signature verification** | `DISCORD_PUBLIC_KEY` (agent) | Per-application | Is this inbound request genuinely from Discord? |
| **Owner identity** | `discord_identities` table (#166), mirrored from Better Auth link (ADR-0138) | Owner-scoped, keyed on Discord user id | Which Tendnote owner does this Discord user capture for? |
| **Install / target metadata** | `discord_installs` table (#168, ADR-0139) | Owner-scoped, unique `(owner, guild)` | Which owner installed the app into which guild, and where — if anywhere — their proactive deliveries could land? |
| **Workflow delivery targets** | `scheduled_workflow_delivery_settings` (#170, ADR-0141) | Owner-scoped, per workflow + channel | For one scheduled workflow, which Discord target receives a proactive nudge, and under what disclosure policy? |

Key distinctions:

- **Owner identity is not authority to share.** A resolved owner captures only
  their own **private** records (ADR-0140); guild/channel membership never grants
  household or shared visibility.
- **Install metadata is not a delivery target.** `discord_installs` records that
  an owner installed the shared app into a guild and stores non-secret scope /
  permission metadata; the actual proactive destination for a workflow lives in
  `scheduled_workflow_delivery_settings`. A guild id is intentionally **not
  unique** in `discord_installs`, which is what lets multiple Tendnote users share
  one guild without one owner's state leaking into another's.
- **Current state (honest scope):** there is **no automated OAuth install
  callback** that populates `discord_installs` yet — #168 landed the data model,
  owner+guild-scoped writes, and a fail-closed `deriveDeliveryTarget` read seam
  only. Bot installation today is the manual invite in [§7](#7-install-or-invite-the-bot),
  and proactive targets are configured directly on the workflow delivery setting
  ([§10](#10-proactive-delivery-checklist)), not derived from an install row.

---

## 1. Create the Discord application

Open the [Discord Developer Portal](https://discord.com/developers/applications)
and create or select the application for Tendnote.

Record these values:

| Value | Where to find it | Used for |
| --- | --- | --- |
| Application (Client) ID | **General Information** / **OAuth2** | Command registration, deferred responses, and the OAuth client id. |
| Client secret | **OAuth2** | Better Auth Discord account linking (server-only). |
| Public key | **General Information** | Verifying Discord interaction signatures. |
| Bot token | **Bot** | Proactive messages, fallback posts, and typing indicators. |

Never commit the client secret or bot token, or paste either into issues, logs,
or PRs.

## 2. Discord Developer Portal settings

All of the following are configured in the Developer Portal by an operator.

### OAuth2 redirect (callback) URL — for account linking

Better Auth performs the Discord OAuth redirect for the account-link flow. Add
its callback URL under **OAuth2 → Redirects**:

| Environment | Authorization callback URL |
| --- | --- |
| Local | `http://localhost:3000/api/auth/callback/discord` |
| Production | `<BETTER_AUTH_URL>/api/auth/callback/discord` |

Tendnote requests only the `identify` scope for this flow (never `email`), so
phone-only / no-email Discord accounts link cleanly (ADR-0138).

### Interactions endpoint URL — for slash commands / components

Discord sends slash commands and component/modal interactions to Tendnote's Eve
Discord channel route. The route is served by the **agent** app and proxied
same-origin through the web app (`withEve`), so the public URL is on the web
domain:

| Environment | Interactions Endpoint URL |
| --- | --- |
| Local via tunnel | `https://<tunnel-domain>/eve/v1/discord` |
| Production | `https://<production-domain>/eve/v1/discord` |

Local Discord testing requires a public HTTPS tunnel to the web app because
Discord cannot call `localhost` directly. Discord verifies the endpoint by
sending signed requests, so `DISCORD_PUBLIC_KEY` must be set before verification
will pass.

### Bot permissions

Grant only what the Private Capture Channel needs:

- receive slash command interactions
- send messages / followups
- use components / modals through interactions
- send proactive messages only to explicitly configured targets

Do not add broad moderation, admin, or unrelated bot permissions.

### Slash command registration

Register the `/capture` command (see [§8](#8-register-slash-commands)).

## 3. Environment variables

Discord configuration is split across the two apps by responsibility. **Nothing
below is client-side**: none of these are prefixed with `NEXT_PUBLIC_`, and they
must stay server-only secrets/configuration.

### Web app (`apps/web/.env.local`) — OAuth client for account linking

Better Auth (in the web app) owns the Discord OAuth flow and token custody.

```bash
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
```

- Set **both** to enable the "Connect" Discord flow on the account page; leave
  either unset and the flow stays hidden.
- Authorization callback URL: `<BETTER_AUTH_URL>/api/auth/callback/discord`.
- Only the `identify` scope is requested.

### Agent app (`apps/agent/.env.local`) — interaction + bot secrets

The Eve agent verifies inbound interaction signatures and posts proactive
messages.

```bash
DISCORD_PUBLIC_KEY=
DISCORD_APPLICATION_ID=
DISCORD_BOT_TOKEN=
# Dev / private-beta fallback only — see §5. Ignored when NODE_ENV=production.
DISCORD_OWNER_USER_MAP=discord-user-id:tendnote-owner-user-id
```

- `DISCORD_PUBLIC_KEY` verifies `X-Signature-Ed25519` and
  `X-Signature-Timestamp`.
- `DISCORD_APPLICATION_ID` identifies the Discord application for deferred
  responses and command registration.
- `DISCORD_BOT_TOKEN` is required for proactive messages, fallback messages, and
  typing indicators.
- `DISCORD_OWNER_USER_MAP` is a **private-beta / dev fallback only**, not the
  hosted SaaS resolution path. When set for local use, use comma-separated
  `discordUserId:ownerUserId` pairs, or a JSON object such as
  `{"discordUserId":"ownerUserId"}`.

## 4. Production owner identity: connect Discord (Better Auth)

This is the production path. A signed-in Tendnote user connects Discord from the
account settings page; no owner is ever hand-mapped in production.

1. **Connect.** On **/account → Provider Connections**, the user clicks
   **Connect** on Discord. This calls Better Auth `linkSocial` with the `discord`
   provider and the `identify` scope; Better Auth performs the OAuth redirect and
   owns token custody. Tendnote handles no token or provider URL directly.
2. **Reconcile (on return to /account).** Tendnote mirrors the completed link
   into two **non-secret, owner-scoped** records (ADR-0138):
   - a row in `discord_identities` mapping the Discord user id → this Tendnote
     owner (the value inbound interactions resolve against), and
   - a Discord **Provider Connection** (provider `discord`, capability `channel`)
     that the account page reads and shows as **Connected**.
   The stable key is the Discord **user id** (`accountId` snowflake), never an
   email. The reconcile also best-effort resolves the Discord username via
   `/users/@me` and stores it as the connection's display identity, falling back
   to a labeled id (`Discord ID: …`) when the username can't be fetched.
3. **Conflict handling.** If the linked Discord user id is already mapped to a
   **different** Tendnote owner, it is **never silently reassigned**. The
   connection is surfaced as an actionable conflict ("linked to a different
   Tendnote account…"), including when a concurrent claim races the pre-check.
4. **Disconnect.** Clicking **Disconnect** is Discord-scoped only (Google/other
   capabilities are untouched) and does three things in order:
   1. authoritatively unlinks the Better Auth Discord account by provider +
      account id (so the reconcile can't re-link it),
   2. removes the owner's persisted `discord_identities` mapping so inbound
      interactions **fail closed**, and
   3. marks the Discord Provider Connection `revoked` with an audit entry.

## 5. Owner resolution order

Discord interactions must map to a Tendnote owner before Eve can capture context.
Resolution is **fail-closed**: an interaction from a Discord user id with no owner
mapping is rejected before any Source Record, Memory, Follow-Up, draft, or
delivery setting is written. Owner ids are never accepted from the Discord request
body, slash command options, or any client-supplied field.

Resolution order (`createDiscordRequestOwnerResolver`):

1. **Persisted Discord identity (production path).** Owner-scoped rows in the
   `discord_identities` table, created by the Better Auth connect flow in
   [§4](#4-production-owner-identity-connect-discord-better-auth). This is the SaaS
   resolution path and the only path used in production.
2. **`DISCORD_OWNER_USER_MAP` env map (private-beta / dev fallback only).**
   Consulted **only when `NODE_ENV !== "production"`** and only when no persisted
   identity exists — persisted identity always wins. Do not rely on it for hosted
   deployments.

At minimum, verify:

- the Discord user id is mapped to the expected Tendnote owner
- unmapped Discord users cannot create Tendnote relationship context
- the browser/session owner cannot be overridden by a Discord request body field
- captured context is owner-scoped in the same way as web and Eve HTTP channel
  behavior

## 6. Install and delivery-target state

Two owner-scoped tables back the shared-app model. Neither stores secrets: no bot
token, no request signature, no raw interaction payload.

- **`discord_installs`** (#168, ADR-0139) records that an owner installed the
  shared app into a guild, keyed on the unique `(owner, guild)` pair, storing the
  Discord user id, target kind + channel id, enabled flag, granted OAuth `scopes`,
  and the bot `permissions` bitfield. Because a guild id is not unique here,
  multiple owners can share one guild safely; every write only ever touches the
  requesting owner's row, so cross-owner writes are structurally impossible.
  `deriveDeliveryTarget` is a fail-closed read seam that yields a destination only
  for an enabled install with a configured target (and refuses to guess when more
  than one install is deliverable).
- **`scheduled_workflow_delivery_settings`** (#170, ADR-0141) is where a proactive
  Discord target is actually configured, per workflow (see
  [§10](#10-proactive-delivery-checklist)).

> **Current implementation state.** `discord_installs` is a data model + seams
> only — there is **no OAuth install callback populating it yet**, and no UI reads
> it. Today, install the bot via the manual invite in
> [§7](#7-install-or-invite-the-bot), and configure proactive targets directly on
> the workflow delivery setting.

## 7. Install or invite the bot

Invite the Discord application/bot to the server or private testing space used
for Tendnote, granting only the permissions listed in
[§2 Bot permissions](#bot-permissions). Do not add broad moderation, admin, or
unrelated bot permissions.

## 8. Register slash commands

Register development commands as guild commands first because Discord propagates
guild commands faster than global commands.

The first Private Capture command aligns with Eve's default Discord prompt
extraction: a string option named `message`.

```bash
curl -X PUT "https://discord.com/api/v10/applications/$DISCORD_APPLICATION_ID/guilds/$DISCORD_GUILD_ID/commands" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"name":"capture","description":"Capture private relationship context in Tendnote","type":1,
    "options":[{"name":"message","description":"What should Tendnote capture?","type":3,"required":true}]}]'
```

Use global commands only after the command shape is stable.

## 9. Local smoke checklist

Run after the Discord private capture channel slice lands. Uses the production
connect flow ([§4](#4-production-owner-identity-connect-discord-better-auth)) for
identity; only fall back to `DISCORD_OWNER_USER_MAP` when testing without OAuth
credentials.

### Setup

- [ ] **Endpoint verification:** Discord accepts the configured
      `/eve/v1/discord` interactions endpoint.
- [ ] **Command registration:** The `/capture message:<text>` command appears in
      the test guild.

### Identity and capture

- [ ] **Connect (production path):** A signed-in Tendnote user connects Discord on
      **/account** via Better Auth `linkSocial`. On return the connection shows
      **Connected** with the Discord username (or a labeled id), and a
      `discord_identities` row + Discord Provider Connection are persisted.
- [ ] **Connected-user capture:** From the connected Discord user,
      `/capture message: Maya is moving in August` creates an owner-scoped Source
      Record / reviewable suggestion for **that** owner — not an approved Memory or
      active Follow-Up.
- [ ] **Unmapped-user rejection:** An interaction from a Discord user id with no
      persisted identity (and no dev env-map entry) is rejected **before** any
      Source Record, Memory, Follow-Up, draft, or delivery setting is written.
- [ ] **Disconnect behavior:** Clicking **Disconnect** unlinks the Better Auth
      account, removes the `discord_identities` mapping, and marks the connection
      `revoked`. A subsequent `/capture` from the same Discord user now
      **fails closed** (rejected), and Google/other capabilities are untouched.
- [ ] **Multi-owner, same guild:** Two Discord users in the **same** guild, each
      connected to a **different** Tendnote owner, each `/capture` to their **own**
      owner. The shared guild grants neither owner visibility into the other's
      capture (owner resolves by Discord user id, never by guild).
- [ ] **Household-safe capture:** A Discord-captured record is **private**
      owner-scoped (ADR-0140) and stays invisible to other household members
      through the shared-scope read model — it does not appear in another member's
      Eve answers, review surfaces, or scheduled artifacts.
- [ ] **Clarification (HITL):** Ambiguous capture prompts Eve to ask a
      clarification through Discord components / a modal, then resumes the same
      session after response.
- [ ] **Boundary:** Discord attachments are ignored or rejected as Cleanup Preview
      input.
- [ ] **Secret safety:** Logs contain no bot token, client secret, raw Discord
      signatures, or unnecessary Discord payload dumps.

## 10. Proactive delivery checklist

Configure proactive delivery through the scheduled workflow delivery setting for
the exact workflow. Each setting is owner-scoped and channel-specific. There is
**no UI** for these fields today — they are set on the delivery setting record
(`scheduled_workflow_delivery_settings`): `workflow`, `channel: "discord"`,
`targetId` (private Discord channel id or DM target), `enabled`, `allowSensitive`,
plus the Phase 4 target disclosure profile `targetScope` (defaults to `private`),
`targetHouseholdId`, and `allowPrivateSummary` (ADR-0141).

Delivery outcomes are recorded in `scheduled_workflow_delivery_attempts` as
`sent`, `skipped`, or `failed`. The scheduled artifact remains the source of truth
in Tendnote — Discord is only a nudge.

- [ ] **Target setup:** Configure a Discord `targetId` for one scheduled workflow
      only, leaving the other workflows in-app only. Confirm each workflow can use
      a different target without changing the others.
- [ ] **Persist first:** Trigger the workflow and verify the scheduled artifact is
      persisted before Discord delivery is attempted.
- [ ] **Delivery:** The configured Discord target receives a concise private nudge
      that points back to the Tendnote artifact or presents only policy-safe
      summary content.
- [ ] **No target:** A workflow with no Discord target still produces an in-app
      artifact, records a skipped delivery attempt with `missing_discord_target`,
      and sends nothing to Discord.
- [ ] **Failure fallback:** Break Discord delivery credentials or target access.
      The Tendnote artifact remains reviewable, and the failed delivery attempt is
      visible/recoverable with the artifact id and error.
- [ ] **Sensitivity filtering:** `restricted` content is **never** delivered.
      `sensitive` content is delivered only when `allowSensitive` is explicitly
      enabled for that workflow; otherwise it is skipped, not sent.
- [ ] **Scope filtering (Phase 4):** With a `private` target (the fail-closed
      default), the owner's own artifacts of any scope are allowed. A
      `household` artifact reaches a shared/household target only when
      `targetScope: "household"` **and** `targetHouseholdId` matches the artifact's
      household (else `household_target_required` / `household_target_mismatch`). A
      `private` artifact sent to a shared/household target is filtered
      (`private_content_filtered`) unless `allowPrivateSummary` is set **and** the
      artifact is `normal` sensitivity — sensitive + private-summary never compound.
      A `shared` (selected-members) artifact sent to a shared/household target is
      **always** filtered (`shared_content_filtered`): a Discord channel cannot
      honor selected-member granularity, so it has no honest home there.

## 11. Hosted smoke checklist

- [ ] Web env sets `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`; agent env sets
      `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `DISCORD_BOT_TOKEN`. No
      Discord value is exposed client-side (`NEXT_PUBLIC_`), and
      `DISCORD_OWNER_USER_MAP` is unset (or known-ignored) in production.
- [ ] The production `/eve/v1/discord` endpoint is registered and passes
      Developer Portal endpoint verification.
- [ ] The production OAuth redirect `<BETTER_AUTH_URL>/api/auth/callback/discord`
      is registered, and connecting Discord from /account persists an identity +
      Connected Provider Connection.
- [ ] Slash commands are registered for the intended guild or globally after the
      command shape is stable.
- [ ] Owner resolution rejects unmapped Discord users, and disconnect fails the
      channel closed.
- [ ] Connected-user capture, HITL clarification, and proactive delivery (with
      sensitivity + scope filtering) behave according to the local checklists.
- [ ] Hosted logs contain no bot token, client secret, raw signatures,
      unnecessary Discord payloads, or relationship context beyond minimized
      operational logging.
