# ADR 0254: Next dev validates in process and compiles React natively

Status: Accepted by the owner in the October 3, 2026 implementation request for
issue #684.

## Context

After [ADR 0253](0253-eve-dev-compiles-in-a-disposable-process.md) flattened
Eve, `next dev` was the larger consumer on the 2-vCPU, 8 GB development VM
(no swap, browser on another machine). The full stack fell to 1.1-1.8 GiB
available during its first four routes, short of the 2 GiB the issue asked to
keep for T3 and one agent session. Measured with a guarded harness that samples
per-process PSS, `MemAvailable`, memory PSI, and T3 latency, plus a preload that
logs every V8 isolate's heap:

- **The Next server's footprint is mostly native Turbopack memory, and most of
  it is transient.** Compiling the first routes drives the server to about
  3 GiB, then Turbopack evicts to its filesystem cache and the server settles
  near 1.5 GiB. With the filesystem cache off it never evicts and stays near
  2.8 GiB, so the default stays.
- **The "transform worker" was the React Compiler.** Turbopack runs the Babel
  React Compiler in two Node loader workers, about 0.46 GiB each. The PostCSS
  worker is about 0.1 GiB.
- **The dev server grew with every page request.** Repeated GETs of `/`,
  `/assistant`, and `/people`, with no edits, added 10-20 MiB per request
  without levelling off. The growth was in a second V8 isolate inside the
  server process: the Cache Components dev validation worker
  (`experimental.devValidationWorker`, on by default since Next 16.3). It loads
  its own copy of the app, and after a forced GC it still held 1.17 GiB, up from
  about 0.5 GiB, after 90 requests. Next 16.3.8 behaves the same. The Babel and
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
  "full"`.** Off removes eviction and keeps about 1.3 GiB more; `"full"` did not
  lower the footprint (ADR 0253).
- **Turn off dev source maps.** Loses debugging information for an unmeasured
  gain.
- **The Rust compiler in builds too.** It is experimental; dev is where its
  memory saving matters, and keeping builds on Babel means a port divergence
  shows up as a dev-only difference, not shipped code.
- **Heap caps or swap.** They change how the server fails, not why it grows.

## Consequences

Root `pnpm dev` on the VM, from an empty `.next`: `/sign-in`, `/`,
`/assistant`, `/people`, an assistant turn, three edits to
`packages/domain/src/privacy.ts` and the People page, then 16 minutes of
repeated route requests with an assistant turn every third cycle. The browser
and T3 ran outside the measured tree; available memory is the host's.

| Run | Lowest available | Next server after use | Outcome |
| --- | ---: | ---: | --- |
| Before (Babel compiler, validation worker) | 1.06 GiB | 3.1 GiB, still compiling | Guard stopped it at the second route |
| Rust compiler only | 1.86 GiB | 1.97 GiB growing to 2.5 GiB | Completed; Next grew through the idle phase |
| Both changes | 2.65 GiB | 0.9-1.15 GiB, flat | Completed; 4.4-4.6 GiB available while idle |
| Both changes, warm `.next`, 180 back-to-back requests | 3.45 GiB | 1.7 GiB | Completed |

The lowest points with both changes are Eve's per-rebuild compiler (ADR 0253)
and Next's first compiles, both transient. T3 answered within 100 ms throughout,
and memory PSI stayed under 0.5%. A headless browser on the VM itself running an
assistant turn left 3.3-4.1 GiB available. Exactly one Eve runtime ran, and
Ctrl+C left no owned process behind. Heavy request loops still grow the server
by about 2-3 MiB per request before V8 collects, against 10-20 MiB before.

Validation now shares the dev server's event loop, so a navigation can wait on
the previous one's validation; Next added the worker for responsiveness during
rapid navigation. Dev and production run different React Compiler
implementations. If a component behaves differently between `next dev` and a
build, suspect the compiler before anything else and reproduce with the flag
off.

Remove `devValidationWorker: false` once a Next release stops the worker's
per-request retention, and revisit the phase split when the Rust compiler
becomes Next's default.
