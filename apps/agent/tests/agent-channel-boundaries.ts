import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";

export const allowedAgentChannels = ["discord.ts", "eve.ts"];

export function expectAllowedAgentChannels(agentRoot: string): void {
  expect(readdirSync(join(agentRoot, "channels")).sort()).toEqual(allowedAgentChannels);
}

export function expectChannelToExclude(agentRoot: string, channel: string, pattern: RegExp): void {
  expect(readFileSync(join(agentRoot, "channels", channel), "utf8")).not.toMatch(pattern);
}
