# BotID on the public activity endpoint

Tendnote does not put Vercel BotID, or any other client-side bot challenge, in front of the anonymous public activity endpoint.

## Why this is out of scope

Public activity is anonymous by design. The [hosted telemetry decision](../docs/phase-9b/hosted-telemetry-and-data-boundary.md) forbids a persistent visitor identifier and visitor fingerprinting, and the marketing site sends each report with no cookie, no credentials, and no referrer.

BotID conflicts with that boundary in two ways:

- **Deep Analysis is fingerprinting.** It works by silently collecting thousands of client-side signals and streaming them to Kasada's model. That is exactly the visitor fingerprinting the telemetry decision rules out, and it would add a processor the Privacy & AI page does not disclose.
- **The challenge can't ride on the report as sent.** The BotID client attaches its solution to protected requests as a header. The marketing site reports with `mode: "no-cors"`, which only allows CORS-safelisted headers. Carrying the challenge would mean switching the report to CORS with a preflight, adding BotID's challenge script to the static marketing site, and allow-listing the site's host on the server. Basic mode avoids the Kasada signals but still needs all of that.

The harm being defended against is an inflated anonymous counter, which holds no personal data and reaches no account. Per-client volume is bounded at Vercel's edge with a WAF rate-limit rule, which Tendnote never sees the key for (#710), and oversized bodies are refused in the route (#708). The report's coverage note already says counts can run high.

## Prior requests

- #708: "Rate-limit and bot-filter the public activity endpoint" (option 2)
