# Discord Setup

> **Human-in-the-loop setup.** This guide configures a Discord application,
> Tendnote environment variables, slash commands, and smoke checks for the Phase
> 3 private capture channel. Discord Developer Portal steps cannot be completed
> by an agent or by code; an operator with access to the Discord application must
> run them.

Tendnote uses Discord as its first non-web **Private Capture Channel**
(ADR-0122). Discord is a channel, not a Provider Connection and not a generic Eve
connection. It is used for owner-scoped quick capture, HITL clarification/review,
and explicitly configured proactive delivery targets.

Do **not** use Discord as a file import path in Phase 3. Current Eve Discord
channel support does not include inbound attachments, so Cleanup Preview input
should stay in the web app plus sandbox workflow.

---

## 1. Create the Discord application

Open the [Discord Developer Portal](https://discord.com/developers/applications)
and create or select the application for Tendnote.

Record these values:

| Value | Where to find it | Used for |
| --- | --- | --- |
| Application ID | **General Information** | Editing deferred responses and command registration. |
| Public key | **General Information** | Verifying Discord interaction signatures. |
| Bot token | **Bot** | Proactive messages, fallback posts, and typing indicators. |

Never commit the bot token or paste it into issues, logs, or PRs.

## 2. Configure the interactions endpoint

Discord sends slash commands and component/modal interactions to Tendnote's Eve
Discord channel route:

| Environment | Interactions Endpoint URL |
| --- | --- |
| Local via tunnel | `https://<tunnel-domain>/eve/v1/discord` |
| Production | `https://<production-domain>/eve/v1/discord` |

Local Discord testing requires a public HTTPS tunnel to the web app because
Discord cannot call `localhost` directly.

Discord verifies the endpoint by sending signed requests. The app must have
`DISCORD_PUBLIC_KEY` set before endpoint verification will pass.

## 3. Environment variables

Set the Discord values in the Eve/web runtime environment used by the deployed
app. For local testing, set them in the same local environment used to run the
Eve-mounted web app.

```bash
DISCORD_PUBLIC_KEY=
DISCORD_APPLICATION_ID=
DISCORD_BOT_TOKEN=
# Dev/private-beta fallback only — see "Owner mapping" below.
DISCORD_OWNER_USER_MAP=discord-user-id:tendnote-owner-user-id
```

- `DISCORD_PUBLIC_KEY` verifies `X-Signature-Ed25519` and
  `X-Signature-Timestamp`.
- `DISCORD_APPLICATION_ID` identifies the Discord application for deferred
  responses and command registration.
- `DISCORD_BOT_TOKEN` is required for proactive messages, fallback messages, and
  typing indicators.
- `DISCORD_OWNER_USER_MAP` is a **private-beta / dev fallback only**, not the
  hosted SaaS resolution path (see [§6 Owner mapping](#6-owner-mapping) for the
  full resolution order). When set for local use, use comma-separated
  `discordUserId:ownerUserId` pairs, or a JSON object such as
  `{"discordUserId":"ownerUserId"}`.

These values are server-only secrets/configuration. Do not prefix them with
`NEXT_PUBLIC_`.

## 4. Register slash commands

Register development commands as guild commands first because Discord propagates
guild commands faster than global commands.

The first Phase 3 command should align with Eve's default Discord prompt
extraction: a string option named `message`.

```bash
curl -X PUT "https://discord.com/api/v10/applications/$DISCORD_APPLICATION_ID/guilds/$DISCORD_GUILD_ID/commands" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"name":"capture","description":"Capture private relationship context in Tendnote","type":1,
    "options":[{"name":"message","description":"What should Tendnote capture?","type":3,"required":true}]}]'
```

Use global commands only after the command shape is stable.

## 5. Install or invite the bot

Invite the Discord application/bot to the server or private testing space used
for Tendnote. Grant only the permissions needed for the Phase 3 channel:

- receive slash command interactions
- send messages or followups
- use components/modals through interactions
- send proactive messages only to explicitly configured targets

Do not add broad moderation, admin, or unrelated bot permissions.

## 6. Owner mapping

Discord interactions must map to a Tendnote owner before Eve can capture context.
Resolution is **fail-closed**: an interaction from a Discord user id with no owner
mapping is rejected before any Source Record, Memory, Follow-Up, draft, or
delivery setting is written. Owner ids are never accepted from the Discord
request body, slash command options, or any client-supplied field.

Owner resolution order:

1. **Persisted Discord identity (production path).** Owner-scoped rows in the
   `discord_identities` table map a Discord user id to exactly one Tendnote owner.
   This is the SaaS resolution path and the only path used in production.
2. **`DISCORD_OWNER_USER_MAP` env map (private-beta / dev fallback only).**
   Consulted only when `NODE_ENV !== "production"` and only when no persisted
   identity exists. Do not rely on it for hosted deployments.

At minimum, verify:

- the Discord user id is mapped to the expected Tendnote owner
- unmapped Discord users cannot create Tendnote relationship context
- the browser/session owner cannot be overridden by a Discord request body field
- captured context is owner-scoped in the same way as web and Eve HTTP channel
  behavior

## 7. Local smoke checklist

Run after the Discord private capture channel slice lands.

- [ ] **Endpoint verification:** Discord accepts the configured
      `/eve/v1/discord` interactions endpoint.
- [ ] **Command registration:** The `/capture message:<text>` command appears in
      the test guild.
- [ ] **Owner mapping:** An allowed Discord user maps to the intended Tendnote
      owner; an unmapped user is rejected without writing relationship context.
- [ ] **Quick capture:** `/capture message: Maya is moving in August` creates an
      owner-scoped Source Record or reviewable suggestion, not an approved Memory
      or active Follow-Up.
- [ ] **Clarification:** Ambiguous capture prompts Eve to ask a HITL
      clarification through Discord components or a modal, then resumes the same
      session after response.
- [ ] **Boundary:** Discord attachments are ignored or rejected as Cleanup
      Preview input in Phase 3.
- [ ] **Secret safety:** Logs contain no bot token, raw Discord signatures, or
      unnecessary Discord payload dumps.

## 8. Proactive delivery checklist

Configure proactive delivery through the scheduled workflow delivery setting for
the exact workflow. Each setting is owner-scoped and channel-specific:
`workflow`, `channel: "discord"`, `targetId` (private Discord channel id or DM
target), `enabled`, and `allowSensitive`.

Settings are stored in `scheduled_workflow_delivery_settings`; delivery outcomes
are recorded in `scheduled_workflow_delivery_attempts` as `sent`, `skipped`, or
`failed`. The scheduled artifact remains the source of truth in Tendnote.

- [ ] **Target setup:** Configure a Discord `targetId` for one scheduled workflow
      only, leaving the other workflows in-app only. Confirm each workflow can use
      a different target without changing the others.
- [ ] **Persist first:** Trigger the workflow and verify the scheduled artifact
      is persisted in Tendnote before Discord delivery is attempted.
- [ ] **Delivery:** The configured Discord target receives a concise private
      nudge that points back to the Tendnote artifact or presents only policy-safe
      summary content.
- [ ] **No target:** A workflow with no Discord target still produces an in-app
      artifact, records a skipped delivery attempt with `missing_discord_target`,
      and sends nothing to Discord.
- [ ] **Failure fallback:** Break Discord delivery credentials or target access.
      The Tendnote artifact remains reviewable, and the failed delivery attempt is
      visible/recoverable with the artifact id and error.
- [ ] **Sensitivity:** Sensitive content is excluded unless `allowSensitive` is
      explicitly enabled for that workflow. Restricted content remains excluded
      from proactive Discord delivery.

## 9. Hosted smoke checklist

- [ ] Hosted environment variables set `DISCORD_PUBLIC_KEY`,
      `DISCORD_APPLICATION_ID`, and `DISCORD_BOT_TOKEN`.
- [ ] The production `/eve/v1/discord` endpoint is registered in the Discord
      Developer Portal and passes endpoint verification.
- [ ] Slash commands are registered for the intended guild or globally after the
      command shape is stable.
- [ ] Owner mapping rejects unmapped Discord users.
- [ ] Quick capture, HITL clarification, and proactive delivery behave according
      to the local checklists.
- [ ] Hosted logs contain no bot token, raw signatures, unnecessary Discord
      payloads, or relationship context beyond minimized operational logging.
