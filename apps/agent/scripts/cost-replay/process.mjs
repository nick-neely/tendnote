import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export function completedEval(file) {
  if (!file || !existsSync(file)) return null;
  const xml = readFileSync(file, "utf8");
  if (!xml.includes("</testsuite>")) return null;
  const suite = xml.match(/<testsuite\s[^>]*>/)?.[0];
  if (!suite) throw new Error("Missing eval suite");
  const count = (name) => Number(suite.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1] ?? 0);
  return (
    count("tests") === 1 &&
    count("failures") === 0 &&
    count("errors") === 0 &&
    count("skipped") === 0
  );
}

export function runProcess(
  command,
  args,
  { cwd, env, completionFile, signal, timeoutMs = 21660000 },
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", detached: true });
    let verdict = null;
    let failure;
    let escalation;
    const kill = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const stop = () => {
      kill("SIGTERM");
      escalation ??= setTimeout(() => kill("SIGKILL"), 3000);
    };
    const onAbort = () => {
      failure = new Error("Replay interrupted");
      stop();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const deadline = setTimeout(() => {
      failure = new Error("Replay subprocess timed out");
      stop();
    }, timeoutMs);
    // Eve writes JUnit after evaluating assertions. Its local DB/Redis handles
    // can keep the CLI alive afterward. Reap only this detached child group once
    // that concrete completion artifact is durable, not on a guessed delay.
    const poll = setInterval(() => {
      if (verdict !== null || failure) return;
      try {
        verdict = completedEval(completionFile);
        if (verdict !== null) stop();
      } catch (error) {
        failure = error;
        stop();
      }
    }, 1000);
    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(deadline);
      clearTimeout(escalation);
      signal?.removeEventListener("abort", onAbort);
      // pnpm may exit before its grandchildren. Never leave its eval app alive.
      kill("SIGKILL");
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, exitSignal) => {
      cleanup();
      if (failure) reject(failure);
      else if (verdict === true || (verdict === null && code === 0)) resolve();
      else reject(new Error(`Replay subprocess failed (${code ?? exitSignal})`));
    });
    if (signal?.aborted) onAbort();
  });
}
