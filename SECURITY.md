# Security

Tendnote handles private context about people, households, assets, and tasks.
Please help keep reports and user data out of public discussion.

## Report a vulnerability

Use [GitHub Private Vulnerability Reporting](https://github.com/nick-neely/tendnote/security/advisories)
only. Open the repository's **Security** tab, choose **Advisories**, and use
**Report a vulnerability**. This is the sole reporting channel for suspected
security vulnerabilities; do not use email, public Issues, pull requests, or
another contact path for a vulnerability report.

GitHub exposes that private form only when the repository's Private Vulnerability
Reporting setting is enabled. If the form is unavailable, do not work around it
by posting sensitive material publicly. The repository owner must enable the
GitHub setting before this reporting path can receive reports.

When using the private form, include the smallest reproducible description you
can: affected commit or release, deployment context, steps to reproduce, and
the security impact. Keep credentials, tokens, private records, unrelated
personal data, and unnecessary exploit detail out of public Issues and pull
requests. If a public post already contains sensitive material, do not add
more detail there; use the private channel when it is available.

We will make a best-effort acknowledgement within seven calendar days after
receiving a reproducible report through GitHub Private Vulnerability Reporting.
That is an acknowledgement target only. It is not a remediation deadline,
support commitment, or service-level agreement.

## Scope and limits

The [Security and Privacy document](docs/security.md) describes the controls
implemented in the application and their limits. It distinguishes deterministic
query, ownership, review, approval, and fail-closed controls from model-policy
and evaluation boundaries. Those documents describe the current code and
focused evidence; they do not promise behavior for every deployment, provider,
model version, prompt, or integration.

## Self-hosted deployments

Self-hosting is the operator's own Vercel deployment with operator-owned
infrastructure and credentials. The operator is responsible for securing and
maintaining that environment; see the operator checklist in
[`docs/security.md`](docs/security.md#self-host-operator-responsibilities).
