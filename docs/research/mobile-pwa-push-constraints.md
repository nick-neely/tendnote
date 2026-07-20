# Mobile PWA push constraints

Research for [Research current mobile PWA push constraints](https://github.com/nick-neely/tendnote/issues/253), current as of July 20, 2026.

## Answer

Phase Seven can support mobile Web Push for explicit reminders on iOS and Android. It must treat a notification as a best-effort, per-device alert layered over an authoritative Tendnote reminder record—not as the reminder system or evidence that the owner saw anything.

The safe first slice is opt-in delivery for explicitly timed Actions, Routines, Follow-Ups, and dated Saved Items. It should send one privacy-minimizing notification that explains that a reminder is due and deep-links to the current owner-scoped record. It should not send inferred nudges, silent pushes, repeated nags, or claim exact delivery.

## Platform boundary

### iOS and iPadOS

- Standards-based Web Push has been supported since iOS and iPadOS 16.4, but on those versions it is available only to a website added to the Home Screen and opened as a web app. A manifest with `display: standalone` or `fullscreen` establishes that app-like launch behavior. Permission can be requested only after direct user interaction. Notifications can appear on the Lock Screen, in Notification Center, and on a paired Apple Watch. ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/))
- iOS and iPadOS 26 open Home Screen sites as web apps by default unless the person disables **Open as Web App**, but a proper manifest remains necessary for stable identity, metadata, and compatibility with older supported versions. ([WebKit](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/))
- Apple routes standards-based Web Push through APNs, but Tendnote does not need Apple Developer Program membership. Infrastructure controlling outbound access must allow `*.push.apple.com`. ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/))
- Declarative Web Push is available from iOS and iPadOS 18.4. Its standardized payload includes a required navigation URL and gives the browser enough information to display a fallback notification even if service-worker JavaScript fails or has been removed. Tendnote can use the declarative payload as a progressive enhancement while retaining an ordinary service-worker handler for other and older browsers. ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/))

### Android and Chromium

- Google's standard open-web flow requires HTTPS, notification permission, a service worker, and `PushManager`; it does not make PWA installation a prerequisite for subscribing. An installed Android WebAPK adds stronger launcher and OS integration. Tendnote should feature-detect capabilities rather than browser-detect. ([Google subscription guide](https://web.dev/articles/push-notifications-subscribing-a-user), [Google PWA installation guide](https://web.dev/learn/pwa/installation))
- Android automatically badges an installed web app while it has an unread notification; the explicit App Badging API is not implemented by Chrome on Android. Phase Seven does not need to add badge-count state. ([Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/badging-api))

## Permission and device model

- Ask only from a clear user action such as **Enable reminders on this device**, after explaining the benefit. Do not prompt on first load. Browsers require or are moving toward requiring a user gesture, and Chrome may apply quieter UI to abusive or low-acceptance origins. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API), [Google permission UX](https://web.dev/articles/push-notifications-permissions-ux))
- A denied permission generally cannot be re-prompted by the app; the owner must change it in browser or OS settings. Tendnote needs a visible device-level state, instructions for recovery, and an explicit unsubscribe path. ([Google subscription guide](https://web.dev/articles/push-notifications-subscribing-a-user))
- Permission and subscription are per browser/device, not per Tendnote account. Each device must opt in independently and must be stored as a separate owner-scoped delivery target. ([Google subscription guide](https://web.dev/articles/push-notifications-subscribing-a-user))
- Open-web subscriptions use `userVisibleOnly: true`. Silent background synchronization is not a safe Web Push contract; WebKit can revoke a subscription when a traditional service-worker push handler fails to display a notification. ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/))
- Rich notification actions are not uniform across browsers. The portable first contract is one visible notification with one activation/deep-link target. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/maxActions_static))

## Subscription lifecycle and security

- A `PushSubscription` contains a capability endpoint plus encryption material. The client sends that subscription to Tendnote over an authenticated HTTPS route; Tendnote stores it owner-scoped and does not expose it. The subscription endpoint must be treated as secret because possession can enable sending. ([RFC 8292](https://www.rfc-editor.org/rfc/rfc8292.html), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html))
- Tendnote needs one stable VAPID P-256 signing keypair. The public application-server key goes to clients; the private key remains a protected production secret. Payloads use Web Push message encryption. ([RFC 8292](https://www.rfc-editor.org/rfc/rfc8292.html), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html))
- Subscriptions may expire, refresh, be revoked, or disappear when site data/service workers are removed. `expirationTime` may be absent, and `pushsubscriptionchange` is not uniformly dependable. Tendnote should reconcile `getSubscription()` when the app opens, update changed subscriptions, and retire only the affected device target after terminal provider responses. ([W3C Push API](https://www.w3.org/TR/push-api/), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event), [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html#section-7.3))
- Explicit opt-out, logout policy, account deletion, and permission revocation must disable or delete the matching device target. One dead endpoint must never disable every device belonging to an owner.

## Payload, timing, and delivery

- Every Web Push request includes a TTL. A push service may store a message for less time than requested, stop retrying before expiry, or fail to deliver a zero-TTL message when the device is offline. `Urgency` is a delivery hint, not a deadline guarantee. A provider accepting a request does not prove it reached the device. ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html#section-5.2))
- The protocol guarantees that a push service will not reject an encrypted body solely for size when it is 4,096 bytes or smaller, but encryption overhead consumes part of that budget. Tendnote should send compact payloads with a notification description, an opaque record reference, and a canonical same-origin path—not record bodies or authorization data. ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html#section-7.2), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html))
- A short, relevance-based TTL prevents stale reminders from arriving long after they matter. A stable Web Push topic/tag per reminder occurrence can replace or collapse a still-pending duplicate. Today must still show missed or pending items when push never arrives. ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html#section-5.4))
- Push payload content is encrypted against inspection or modification by the push service, but the service can still observe metadata such as timing, frequency, size, and the subscription endpoint. Lock Screen rendering is an additional ambient disclosure surface. Default copy should therefore avoid people, household details, and sensitive record content unless Phase Seven explicitly adds a preview preference. ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html), [W3C Push API security and privacy](https://www.w3.org/TR/push-api/#security-and-privacy-considerations))

## Deep linking

- Store a canonical same-origin record path in the notification data. On `notificationclick`, the service worker should focus an existing matching client or call `clients.openWindow()`. Chrome on Android may route that URL into the installed standalone app. Declarative Web Push can use its `navigate` member for the same result. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow), [WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/))
- Activation must reload and authorize the current record server-side. A URL must not carry durable authorization or assume the record remains visible to the current session.

## Server capabilities Tendnote needs

1. **Owner-scoped device subscriptions.** Persist one row per subscription with owner, endpoint, keys, optional expiration, install/device label, lifecycle status, and send-health timestamps. Provide authenticated subscribe, reconcile, and unsubscribe operations.
2. **Authoritative reminder occurrences.** Keep the source record, local-time semantics, next due occurrence, completion/snooze state, and recurrence history in Postgres. Push queues and payloads carry pointers, never product truth.
3. **Idempotent due dispatch.** Reuse the app-owned dispatcher pattern: claim due occurrences, then create a unique delivery attempt per reminder occurrence and subscription. Immediately before sending, re-read the owner-scoped source and confirm that it still exists, remains visible and due, and has not been completed, canceled, or snoozed.
4. **Durable asynchronous sends.** Publish claimed delivery pointers to a dedicated queue and make the consumer idempotent. Vercel Queues provides at-least-once delivery, so duplicate processing remains possible. Its delayed delivery and retention are bounded (currently up to seven days), so it should not replace Postgres as the long-term reminder scheduler. ([Vercel Queues](https://vercel.com/docs/queues), [Vercel seven-day TTL](https://vercel.com/changelog/queues-now-supports-7-day-ttl))
5. **Bounded retries and pruning.** Retry transient provider/network failures only while the occurrence remains relevant; retire a device target on terminal expiration/revocation responses. Never repeatedly notify merely to keep a subscription alive.
6. **Privacy-minimal rendering and audit.** Generate compact copy from the current record at send time. Persist delivery attempts, provider acceptance/failure category, and timestamps without retaining unnecessary rendered body content. Acceptance is not a read receipt.
7. **Recovery.** The existing static dispatcher can recover due Postgres work after a missed tick. Any cron-like wakeup must tolerate overlap and duplicate invocation; Vercel Cron itself does not retry failures and can deliver an event more than once. ([Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs))

## Recommended Phase Seven contract

- Opt-in separately on each device.
- Support explicit, timed Actions, Routines, Follow-Ups, and dated Saved Items only.
- Send one calm, user-visible, privacy-minimizing notification for each due occurrence.
- State why it appeared, then deep-link to the authoritative record.
- Keep Today as the recovery surface for anything missed.
- No inferred AI nudges, silent push, notification center, unread-count pressure, repeated nagging, or promise of exact delivery.
- Treat Declarative Web Push as an iOS reliability enhancement while keeping a standards-based service-worker path.

## Decisions surfaced for the Phase Seven map

1. **Lock Screen privacy:** Should Phase Seven always use generic preview text, or offer an explicit per-device preference for record titles/details on ambient surfaces?
2. **Timing semantics:** What lateness window should a reminder occurrence allow before Tendnote suppresses a stale notification, and should a missed occurrence ever send after dispatcher recovery?
3. **Multi-device fan-out:** Should every active opted-in device receive each reminder by default, or should an owner select one preferred device?
4. **Permission timing:** At what earned moment should Tendnote offer **Enable reminders on this device**—during PWA onboarding, after the first dated record is created, or from account/device settings only?

