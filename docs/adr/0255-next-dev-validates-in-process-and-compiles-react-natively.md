# ADR 0255: Next dev validates in process and compiles React natively

Status: Accepted by the owner in the October 3, 2026 implementation request for
issue #684.

## Context

After [ADR 0253](0253-eve-dev-compiles-in-a-disposable-process.md) flattened
Eve, `next dev` was the larger consumer on the 2-vCPU, 8 GB development VM
(no swap, browser on another machine), running Next 16.3.3. The full stack fell
to about 1.0-1.7 GiB available during its first four routes, short of the
2 GiB the issue asked to keep for T3 and one agent session. Measured with a guarded harness that samples
per-process PSS, `MemAvailable`, memory PSI, and T3 latency, plus a preload that
logs every V8 isolate's heap (figures are binary; 1 GiB is 1024 MiB):

- **The Next server's footprint is mostly native Turbopack memory, and most of
  it is transient.** Compiling the first routes drives the server to about
  3 GiB, then Turbopack evicts to its filesystem cache and the server settles
  near 1.5 GiB. With the filesystem cache off it never evicts and stays near
  2.7 GiB, so the default stays.
- **The "transform worker" was the React Compiler.** Turbopack runs the Babel
  React Compiler in two Node loader workers, about 0.46 GiB each. The PostCSS
  worker is about 0.1 GiB.
- **The dev server grew with every page request.** Repeated GETs of `/`,
  `/assistant`, and `/people`, with no edits, added 10-20 MiB per request
  without levelling off. The growth was in a second V8 isolate inside the
  server process: the Cache Components dev validation worker
  (`experimental.devValidationWorker`, on by default since Next 16.3). It loads
  its own copy of the app, and after a forced GC its heap still held 1.09 GiB,
  up from about 0.49 GiB, after 90 requests. Next 16.3.8 behaves the same. The Babel and
  Rust compilers both show it, and it does not depend on fonts, glibc malloc
  arenas, or the manifest contexts that vercel/next.js#93964 describes (those are
  collected).
- **The app's import graph is not the lever.** Every member route ships the
  Streamdown Mermaid, Shiki, KaTeX, and CJK plugins, but removing all four
  lowered the compile peak by only about 0.3 GiB and the settled footprint not
  at all.

## Decision

1. **`experimental.devValidationWorker: false`.** Cache Components validation
   runs on the dev server's own thread, sharing its modules. The flag only
   affects `next dev` with Turbopack; build-time validation is unchanged.
2. **`next dev` uses Turbopack's Rust React Compiler**
   (`experimental.turbopackRustReactCompiler`). The config is phase-aware:
   `nextConfigForPhase` turns the port on for `PHASE_DEVELOPMENT_SERVER` only,
   so `next build`, the Instant matrix, and production keep the Babel compiler.
   `apps/web/next.config.test.ts` holds both settings.

## Alternatives rejected

- **Upgrade Next.** 16.3.8, the latest stable release on October 3, 2026, has
  the same validation-worker growth. Its security fixes are a separate upgrade.
- **Drop or narrow the Streamdown plugins.** A product change for about
  0.3 GiB of transient peak.
- **Turn off the Turbopack filesystem cache, or `turbopackMemoryEviction:
  "full"`.** Off removes eviction and keeps about 1.2 GiB more; `"full"` did not
  lower the footprint (ADR 0253).
- **Turn off dev source maps.** Loses debugging information for an unmeasured
  gain.
- **The Rust compiler in builds too.** It is experimental; dev is where its
  memory saving matters, and keeping builds on Babel means a port divergence
  shows up as a dev-only difference, not shipped code.
- **Heap caps or swap.** They change how the server fails, not why it grows.

## Consequences

Full runs are root `pnpm dev` on the VM: `/sign-in`, `/`, `/assistant`,
`/people`, an assistant turn, three edits to `packages/domain/src/privacy.ts`
and the People page, then 16 minutes of repeated route requests with an
assistant turn every third cycle. The browser and T3 ran outside the measured
tree; available memory is the host's.

| Run | Lowest available | Next server after the routes | Outcome |
| --- | ---: | ---: | --- |
| Before, cold (quick run: routes and a turn only) | 1.04 GiB | 3.03 GiB, still compiling | Guard stopped it at the second route |
| Rust compiler only, cold, full | 1.82 GiB | 1.51 GiB, growing to 2.45 GiB | Completed; Next grew through the idle phase |
| Both changes, cold, full | 2.59 GiB | 0.84-1.41 GiB; 0.90-1.15 GiB while idle | Completed; 3.96-4.54 GiB available while idle |
| Both changes, warm, full | 2.54 GiB | 0.59-1.26 GiB; 0.77-1.04 GiB while idle | Completed; 4.00-4.65 GiB available while idle |
| Both changes, warm, 180 back-to-back requests | 3.37 GiB | 0.87 GiB, peaking at 2.10 GiB, settling at 1.69 GiB | Completed |

The lowest points with both changes are Eve's per-rebuild compiler (ADR 0253)
and Next's first compiles, both transient. T3 answered within 100 ms and memory
PSI stayed under 1% in every run with both changes. The harness counted at most
one Eve runtime, and after Ctrl+C no Next or Eve process remained; only pnpm's
shell wrapper took longer than 20 seconds to exit. In the back-to-back run the
first 30 requests added about 0.87 GiB while in-process validation warmed up,
and the next 150 added about 2 MiB each before V8 collected, against a sustained
10-20 MiB per request with the worker. Spot checks with `free` while a headless
browser on the VM ran an assistant turn showed 3.2-4.0 GiB available.

Validation now shares the dev server's event loop, so a navigation can wait on
the previous one's validation; Next added the worker for responsiveness during
rapid navigation. Dev and production run different React Compiler
implementations. If a component behaves differently between `next dev` and a
build, suspect the compiler before anything else and reproduce with the flag
off.

Remove `devValidationWorker: false` once a Next release stops the worker's
per-request retention, and revisit the phase split when the Rust compiler
becomes Next's default.
