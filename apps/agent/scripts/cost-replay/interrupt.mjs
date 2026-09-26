// Persist the terminal intent before waiting for subprocess or proxy cleanup.
// A second signal must not bypass that cleanup via Node's default termination.
export function registerReplayInterrupt({ meter, abort, metadata, write }) {
  let interrupted = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      if (interrupted) return;
      interrupted = true;
      metadata.status = "partial";
      metadata.failure = `Replay interrupted by ${signal}`;
      metadata.interruption = { signal, at: new Date().toISOString() };
      try {
        write("metadata.json", metadata);
      } finally {
        try {
          meter.stop("interrupted");
        } finally {
          abort.abort();
        }
      }
    });
}
