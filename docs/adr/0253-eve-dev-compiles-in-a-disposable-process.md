# ADR 0253: Eve dev compiles in a disposable process

Status: Accepted by the owner in the October 3, 2026 implementation request for
issue #684.

## Context

`eve dev` compiles the agent by importing every authored module (tools, hooks,
channels, subagents) to read its definition. Each import is its own
content-hashed bundle that inlines the workspace code it reaches, so about 94 of
the agent's 130 bundles each carry a full copy of `@tendnote/db` and
`@tendnote/domain`, plus an inline source map. The copies come from the SDK,
which bundles each module on its own; the app's import graph only sets their
size (44 agent files import the `@tendnote/domain` root barrel). Node never
unloads an ES module.
The 0.47.7 dev host compiled in its own long-lived process, so it kept every
rebuild's bundles: one edit to a widely imported file such as
`packages/domain/src/privacy.ts` retained another ~1 GiB, measured after a
forced garbage collection. On the 2-vCPU, 8 GB development VM, Eve alone grew
from 2.25 GiB at boot to 3.99 GiB after two such edits, and with Next alongside
the host ran out of headroom and stalled T3.

Production is unaffected: deployed builds bundle one module map, and
`prepareProductionApplicationHost` compiles once.

## Decision

**The pinned Eve patch compiles each development generation in a short-lived
child process.** `prepareDevelopmentApplicationHost` forks
`isolated-compile-child.js`, which runs the unchanged `compileAgentInWorkspace`,
sends back the plain-data compile result, and exits. Errors are rebuilt on the
host side with their message, stack, code, and cause chain, as a
`CompileAgentError` (with its `result`), an `AggregateError`, or a built-in
error class; any other class arrives as an `Error` carrying its original name. The child also exits if the host goes away, so a killed
dev server leaves no compiler behind.

`apps/agent/tests/eve-dev-compile-isolation.test.ts` holds the boundary through
Eve's real dev entry: authored modules are not evaluated in the host, the host
gains no threads across rebuilds, compile and evaluation failures keep their
shape, and the compiler ends when its host is killed.

## Alternatives rejected

- **A worker thread instead of a process.** It hides the modules from the host
  isolate, but every thread that loads Rolldown's native binding starts a tokio
  thread pool that is never stopped. The host leaked about seven threads and
  their allocator arenas per rebuild, about 250 MiB RSS each.
- **Externalize the workspace packages** (`build.externalDependencies`) so each
  is loaded once. Node cannot run their extensionless TypeScript imports and
  parameter properties without a dev-only loader such as `tsx`, the cached
  modules would go stale after a workspace edit, and the packages would also be
  externalized in the production generation.
- **Drop the inline source maps.** About 0.46 GiB at boot, but it leaves the
  per-rebuild retention in place and removes debugging information.
- **Upgrade Eve.** 0.70.2, the latest release on October 3, 2026, still loads
  every authored module into the dev host with inline maps.
- **Heap caps or swap.** They change how the host fails, not why it grows.

## Consequences

Eve's memory stays flat across rebuilds. On the development VM, Eve alone settled
at about 1.0 GiB after boot and 0.8-0.9 GiB through repeated shared-file edits.
A rebuild still peaks at about 2.7 GiB while the compiler process runs, and
each rebuild pays about half a second of process startup. Narrowing the agent's
imports would lower that transient peak, not the retention this fixes.

This does not make the whole `pnpm dev` stack fit the VM with 2 GiB to spare.
With Eve flat at 0.6-1.1 GiB, Next's first compiles of `/assistant` reached
2.5-3.1 GiB plus a 0.9-1.0 GiB transform worker, and available memory fell to
1.1-1.8 GiB, with the browser running on another machine. T3 stayed responsive
(under 30 ms) and memory pressure stayed low, but the remaining shortfall is
Next's, and `turbopackMemoryEviction: "full"` did not reduce it.

The patch lives in `patches/eve@0.47.7.patch` beside the earlier hunks and must
be carried or dropped on every Eve upgrade. The upstream fix belongs in Eve's dev
host. Remove the hunk once a release compiles outside the long-lived host
process.
