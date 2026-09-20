import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("persists interruption before child cleanup even if the runner is then killed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-interrupt-"));
  const module = pathToFileURL(resolve("scripts/cost-replay/interrupt.mjs")).href;
  const code = `
    import { writeFileSync } from 'node:fs';
    import { registerReplayInterrupt } from ${JSON.stringify(module)};
    const metadata = { status: 'running' };
    const write = (name, data) => writeFileSync(${JSON.stringify(dir)} + '/' + name, JSON.stringify(data));
    write('metadata.json', metadata);
    registerReplayInterrupt({metadata, write,
      meter: {stop: () => {}},
      abort: {abort: () => process.send('aborted')}
    });
    process.on('message', () => process.send('alive'));
    setInterval(() => {}, 1000);
    process.send('ready');
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  try {
    await once(child, "message");
    const aborted = once(child, "message");
    child.kill("SIGTERM");
    await aborted;
    const alive = once(child, "message");
    child.kill("SIGTERM");
    child.send("ping");
    expect((await alive)[0]).toBe("alive");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
    expect(metadata.status).toBe("partial");
    expect(metadata.interruption.signal).toBe("SIGTERM");
    expect(metadata.interruption.at).toMatch(/^\d{4}-/);
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
