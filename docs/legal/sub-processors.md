# Tendnote Sub-processors

**Dated 2026-10-02**

These are the companies that process customer data for the hosted Tendnote
service operated by Neely Solutions LLC. The list is kept in the repository so
that adding a sub-processor is a reviewed change. It covers the hosted service
only; a self-hosted deployment chooses its own providers.

| Sub-processor | Purpose |
| --- | --- |
| Vercel | Hosting the service, feature flags, background queues, private file storage (Vercel Blob), and the AI Gateway that routes model calls |
| Neon | The Postgres database that holds account content |
| Upstash | Redis for sign-in sessions, short-lived caching, and rate limits |
| Resend | Transactional email: email confirmation, password resets, and household invitations |
| Google Cloud (Vertex AI) | Language model inference for the Assistant and background features, reached through the Vercel AI Gateway with zero data retention and no training |
| OpenAI | Text embeddings for search, reached through the Vercel AI Gateway with zero data retention and no training |
| Stripe | Subscription payments, invoices, and sales tax |
| Google APIs | Calendar, Gmail drafts, and Contacts, only when a customer connects their Google account |

Better Auth, which handles sign-in, is a library that runs inside the
deployment, not a company that receives data, so it is not a sub-processor.
