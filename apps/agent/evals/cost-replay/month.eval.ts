import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb } from "@tendnote/db/client";
import { generateBirthdayGiftPlanning } from "@tendnote/db/queries/birthday-gift-planning";
import { enqueueAndTriggerExtractionJob } from "@tendnote/db/queries/extraction-jobs";
import { captureExplicitMemory } from "@tendnote/db/queries/memories";
import { generateMorningAgenda } from "@tendnote/db/queries/morning-agenda";
import { generatePostMeetingAftercare } from "@tendnote/db/queries/post-meeting-aftercare";
import { captureSourceRecordForPerson } from "@tendnote/db/queries/source-records";
import { generateWeeklyRelationshipReview } from "@tendnote/db/queries/weekly-relationship-review";
import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { defineEval } from "../define-eval";
import {
  ownerUserId,
  seedMonth,
  storedActivity,
  syntheticCalendar,
  uploadEvidence,
  type Workload,
} from "./fixtures";

export default defineEval({
  description:
    "Explicitly opted-in Representative Month replay; never part of policy/deterministic tags.",
  tags: ["cost-replay"],
  timeoutMs: 21600000,
  async test(t) {
    if (!process.env.TENDNOTE_COST_PROXY || !process.env.TENDNOTE_COST_OUTPUT) {
      t.skip("Use eval:cost; a metered isolated app is required.");
      return;
    }
    await replay(t);
  },
});

function configuration() {
  return {
    variant: required("TENDNOTE_COST_VARIANT"),
    output: required("TENDNOTE_COST_OUTPUT"),
    proxy: required("TENDNOTE_COST_PROXY"),
    token: required("TENDNOTE_COST_PROXY_TOKEN"),
    smoke: required("TENDNOTE_COST_MODE") === "smoke",
    workload: JSON.parse(required("TENDNOTE_COST_WORKLOAD")) as Workload,
  };
}
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
type Config = ReturnType<typeof configuration>;
type Progress = {
  status: string;
  turns: number;
  captures: number;
  followups: number;
  uploads: number;
  scheduledChecks: number;
  simulated: boolean;
  workload: Workload;
  storage?: Awaited<ReturnType<typeof storedActivity>>;
};
type Replay = {
  config: Config;
  result: Progress;
  persons: Awaited<ReturnType<typeof seedMonth>>;
  persist: () => void;
};

async function replay(t: EveEvalContext) {
  const config = configuration();
  const result: Progress = {
    status: "partial",
    turns: 0,
    captures: 0,
    followups: 0,
    uploads: 0,
    scheduledChecks: 0,
    simulated: config.smoke,
    workload: config.workload,
  };
  const persist = () =>
    writeFileSync(join(config.output, `${config.variant}.json`), JSON.stringify(result, null, 2));
  try {
    const run = { config, result, persist, persons: await seedMonth(config.workload) };
    if (config.smoke) await smoke(t, run);
    else await paid(t, run);
    await checkMeter(config);
    result.storage = await storedActivity();
    validateActivity(run);
    result.status = "complete";
    t.succeeded();
  } finally {
    persist();
    await closeDb();
  }
}
async function phase(config: Config, category: string) {
  const response = await fetch(`${config.proxy}/phase`, {
    method: "POST",
    headers: { "x-cost-proxy-token": config.token },
    body: JSON.stringify({ variant: config.variant, category }),
  });
  if (!response.ok) throw new Error("Meter phase rejected");
}
async function checkMeter(config: Config) {
  const response = await fetch(`${config.proxy}/status`, {
    headers: { "x-cost-proxy-token": config.token },
  });
  if (!response.ok) throw new Error("Meter unavailable");
  const state = (await response.json()) as { stopped: string | null; pendingRequests: number };
  if (state.stopped || state.pendingRequests) throw new Error("Meter stopped or unsettled");
}
async function smoke(t: EveEvalContext, run: Replay) {
  const turn = await t.send("Say hello briefly. Do not use tools.");
  turn.expectOk();
  if (!turn.message?.includes("Synthetic smoke reply."))
    throw new Error("Smoke reply did not traverse the proxy");
  run.result.turns = 1;
  await smokeBackground(run.persons[0]?.id);
  await uploadEvidence(1);
  run.result.uploads = 1;
  await phase(run.config, "scheduled");
  await generateMorningAgenda({
    ownerUserId,
    localDate: new Date().toISOString().slice(0, 10),
    calendarReaderFor: () => syntheticCalendar(),
  });
  run.result.scheduledChecks = 1;
}
async function smokeBackground(personId: string | undefined) {
  if (!personId) throw new Error("Missing smoke person");
  await captureExplicitMemory({
    ownerUserId,
    personId,
    content: "Fictional friend enjoys pottery.",
  });
  const { sourceRecord } = await captureSourceRecordForPerson({
    ownerUserId,
    personId,
    retainedContent: "A fictional catch-up about pottery.",
  });
  const extraction = await enqueueAndTriggerExtractionJob({
    sourceRecordId: sourceRecord.id,
    runtimeMode: "inline",
  });
  if (extraction.processResult?.outcome !== "completed") throw new Error("Smoke extraction failed");
}
async function paid(t: EveEvalContext, run: Replay) {
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  for (let day = 0; day < 30; day++) {
    const now = new Date(start.getTime() + day * 86400000);
    await runDay(t, run, day, now);
    await checkMeter(run.config);
    run.persist();
  }
}
async function runDay(t: EveEvalContext, run: Replay, day: number, now: Date) {
  await phase(run.config, "interactive");
  await dayTurns(t.newSession(), run, day, now);
  for (const index of dayIndices(day, run.config.workload.uploads)) {
    await uploadEvidence(index + 1);
    run.result.uploads++;
  }
  await phase(run.config, "scheduled");
  await dailySchedules(run, now);
  if (day % 7 === 6) {
    await generateWeeklyRelationshipReview({
      ownerUserId,
      localDate: now.toISOString().slice(0, 10),
      now,
      calendarReaderFor: () => syntheticCalendar(),
    });
    run.result.scheduledChecks++;
  }
}
function dayIndices(day: number, total: number) {
  const start = Math.floor((day * total) / 30);
  return Array.from({ length: Math.floor(((day + 1) * total) / 30) - start }, (_, i) => start + i);
}
async function dayTurns(
  session: ReturnType<EveEvalContext["newSession"]>,
  run: Replay,
  day: number,
  now: Date,
) {
  for (const index of dayIndices(day, run.config.workload.turns)) {
    const step = plannedTurn(run, index, now);
    const turn = await session.send(step.prompt);
    assertSettled(turn);
    requireTools(turn, step.tools);
    run.result.turns++;
    run.result.captures += Number(step.capture);
    run.result.followups += Number(step.followup);
    await checkMeter(run.config);
    run.persist();
  }
}
function plannedTurn(run: Replay, index: number, now: Date) {
  const { workload } = run.config;
  const person = run.persons[index % run.persons.length];
  if (!person) throw new Error("Missing synthetic person");
  const capture =
    Math.floor(((index + 1) * workload.captures) / workload.turns) >
    Math.floor((index * workload.captures) / workload.turns);
  const followup = capture && run.result.followups < workload.followups;
  const explicit = run.result.captures % 4 === 0;
  const identity = `${person.displayName} (person ID ${person.id})`;
  return {
    capture,
    followup,
    ...turnContent({ identity, index, now, capture, followup, explicit }),
  };
}
function turnContent(input: {
  identity: string;
  index: number;
  now: Date;
  capture: boolean;
  followup: boolean;
  explicit: boolean;
}) {
  if (!input.capture)
    return {
      prompt: `What relationship context do I have for ${input.identity}? Give a short grounded answer and one possible next step. Do not write anything.`,
      tools: [],
    };
  const instruction = input.explicit
    ? "Remember their pottery interest as a confirmed private memory."
    : "Log this as a private casual relationship note, not a confirmed memory.";
  const tools = [input.explicit ? "capture_memory" : "capture_source_record"];
  const suffix = followupInstruction(input.now, input.followup);
  return {
    prompt: `I caught up with ${input.identity}. They mentioned enjoying pottery, and we discussed a fictional community picnic, conversation ${input.index + 1}. ${instruction}${suffix.prompt}`,
    tools: [...tools, ...suffix.tools],
  };
}
function followupInstruction(now: Date, followup: boolean) {
  const due = new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10);
  return followup
    ? {
        prompt: ` Also create a follow-up for me to ask them about the picnic on ${due}.`,
        tools: ["create_followup"],
      }
    : { prompt: "", tools: [] };
}
async function dailySchedules(run: Replay, now: Date) {
  const localDate = now.toISOString().slice(0, 10);
  const calendarReaderFor = () => syntheticCalendar();
  await generateMorningAgenda({ ownerUserId, localDate, now, calendarReaderFor });
  await generatePostMeetingAftercare({ ownerUserId, now, calendarReaderFor });
  await generateBirthdayGiftPlanning({ ownerUserId, localDate, now });
  run.result.scheduledChecks += 3;
}
function requireTools(turn: EveEvalTurn, tools: string[]) {
  if (tools.some((name) => !turn.toolCalls.some((call) => call.name === name)))
    throw new Error("Planned mutation was not executed");
}
function assertSettled(turn: EveEvalTurn) {
  turn.expectOk();
  if (turn.inputRequests.length)
    throw new Error("Unresolved input request; preserve partial sample");
  if (turn.toolCalls.some((call) => call.status !== "completed"))
    throw new Error("Tool did not complete; preserve partial sample");
}
function validateActivity(run: Replay) {
  const storage = run.result.storage;
  if (!storage) throw new Error("Missing stored activity");
  if (storage.unfinishedBackgroundJobs !== 0) throw new Error("Unfinished background jobs");
  if (run.config.smoke) return;
  validateCounts(storage.counts, run.config.workload);
}
function validateCounts(counts: Record<string, number>, workload: Workload) {
  const expected = {
    people: workload.people,
    source_records: workload.captures,
    followups: workload.followups,
    asset_evidence_files: workload.uploads,
  };
  if (Object.entries(expected).some(([key, value]) => !((counts[key] ?? 0) >= value)))
    throw new Error("Persisted activity is incomplete");
}
