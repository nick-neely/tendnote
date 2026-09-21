import { readFileSync, writeFileSync } from "node:fs";
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
import { capturePreflight } from "./capture-preflight";
import {
  ownerUserId,
  seedMonth,
  storedActivity,
  syntheticCalendar,
  uploadEvidence,
} from "./fixtures";
import { assertTurnOutcomes, personOutcomes } from "./outcomes";
import { sendReplayTurn } from "./session";
import { dayIndices, plannedTurn, type Workload } from "./workload";

export default defineEval({
  description:
    "Explicitly opted-in Representative Month replay; never part of policy/deterministic tags.",
  tags: ["cost-replay"],
  timeoutMs: 86400000,
  async test(t) {
    if (!process.env.TENDNOTE_COST_PROXY || !process.env.TENDNOTE_COST_OUTPUT) {
      t.skip("Use eval:cost; a metered isolated app is required.");
      return;
    }
    await replay(t);
  },
});

function configuration() {
  const days = Number(required("TENDNOTE_COST_DAYS"));
  if (![2, 30].includes(days)) throw new Error("Invalid replay duration");
  if (days === 2 && required("TENDNOTE_COST_VARIANT") !== "heavy")
    throw new Error("Canary requires the heavy workload");
  return {
    day: configuredDay(),
    fixture: process.env.TENDNOTE_COST_FIXTURE,
    resumeProgress: process.env.TENDNOTE_COST_PROGRESS,
    days,
    variant: required("TENDNOTE_COST_VARIANT"),
    output: required("TENDNOTE_COST_OUTPUT"),
    proxy: required("TENDNOTE_COST_PROXY"),
    token: required("TENDNOTE_COST_PROXY_TOKEN"),
    smoke: required("TENDNOTE_COST_MODE") === "smoke",
    workload: JSON.parse(required("TENDNOTE_COST_WORKLOAD")) as Workload,
  };
}
function configuredDay() {
  return process.env.TENDNOTE_COST_DAY === undefined
    ? undefined
    : Number(process.env.TENDNOTE_COST_DAY);
}
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
type Config = ReturnType<typeof configuration>;
type Progress = {
  status: string;
  days: number;
  turns: number;
  captures: number;
  followups: number;
  uploads: number;
  scheduledChecks: number;
  simulated: boolean;
  workload: Workload;
  lastAttempt?: {
    day: number;
    turn: number;
    capture: boolean;
    explicit: boolean;
    followup: boolean;
    stage: "sending" | "checking-outcomes" | "validated";
  };
  storage?: Awaited<ReturnType<typeof storedActivity>>;
};
type Replay = {
  config: Config;
  result: Progress;
  persons: Awaited<ReturnType<typeof seedMonth>>;
  persist: () => void;
  start: string;
};

async function replay(t: EveEvalContext) {
  const config = configuration();
  const result = replayProgress(config);
  const persist = () =>
    writeFileSync(join(config.output, `${config.variant}.json`), JSON.stringify(result, null, 2));
  try {
    const fixture = await replayFixture(config);
    const run = { config, result, persist, persons: fixture.persons, start: fixture.start };
    if (config.smoke) await smoke(t, run);
    else await paid(t, run);
    await checkMeter(config);
    result.storage = await storedActivity();
    finishReplay(run);
    t.succeeded();
  } finally {
    try {
      result.storage = await storedActivity();
    } catch {
      /* Keep the original replay failure. */
    }
    persist();
    await closeDb();
  }
}
function replayProgress(config: Config) {
  const result: Progress = config.resumeProgress
    ? (JSON.parse(readFileSync(config.resumeProgress, "utf8")) as Progress)
    : {
        status: "partial",
        days: config.days,
        turns: 0,
        captures: 0,
        followups: 0,
        uploads: 0,
        scheduledChecks: 0,
        simulated: config.smoke,
        workload: config.workload,
      };
  result.status = "partial";
  return result;
}
async function replayFixture(config: Config) {
  if (config.day === undefined || config.day === 0) return seedReplayFixture(config);
  if (!config.fixture) throw new Error("Missing checkpoint fixture");
  return JSON.parse(readFileSync(config.fixture, "utf8")) as {
    start: string;
    persons: Awaited<ReturnType<typeof seedMonth>>;
  };
}
async function seedReplayFixture(config: Config) {
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  const fixture = { start: start.toISOString(), persons: await seedMonth(config.workload) };
  if (config.fixture) writeFileSync(config.fixture, JSON.stringify(fixture));
  return fixture;
}
function finishReplay(run: Replay) {
  const final = run.config.day === undefined || run.config.day === run.config.days - 1;
  if (final) validateActivity(run);
  else finishedStorage(run.result.storage);
  run.result.status = final ? "complete" : "checkpoint-ready";
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
  await capturePreflight(run.persons);
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
  const start = new Date(run.start);
  const { first, end } = replayDays(run.config);
  for (let day = first; day < end; day++) {
    const now = new Date(start.getTime() + day * 86400000);
    await runDay(t, run, day, now);
    await checkMeter(run.config);
    run.persist();
  }
}
function replayDays(config: Config) {
  const first = config.day ?? 0;
  const end = config.day === undefined ? config.days : first + 1;
  if (!Array.from({ length: config.days }, (_, index) => index).includes(first))
    throw new Error("Invalid replay day");
  return { first, end };
}
async function runDay(t: EveEvalContext, run: Replay, day: number, now: Date) {
  await phase(run.config, "interactive");
  await dayTurns(t, run, day, now);
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
async function dayTurns(t: EveEvalContext, run: Replay, day: number, now: Date) {
  let session = t.newSession();
  for (const index of dayIndices(day, run.config.workload.turns)) {
    const person = run.persons[index % run.persons.length];
    if (!person) throw new Error("Missing synthetic person");
    const step = plannedTurn(run.config.workload, index, person, now);
    const before = await personOutcomes(person.id);
    // Preserve attempted work separately from validated progress. No prompt or reply.
    run.result.lastAttempt = {
      day: day + 1,
      turn: index + 1,
      capture: step.capture,
      explicit: step.explicit,
      followup: step.followup,
      stage: "sending",
    };
    run.persist();
    const recovered = await sendReplayTurn(session, step.prompt, (id) =>
      t.target.watchTurn(id, { startIndex: 0 }),
    );
    session = recovered.session;
    const turn = recovered.turn;
    assertSettled(turn);
    run.result.lastAttempt.stage = "checking-outcomes";
    run.persist();
    assertTurnOutcomes(step, before, await personOutcomes(person.id));
    run.result.lastAttempt.stage = "validated";
    run.result.turns++;
    run.result.captures += Number(step.capture);
    run.result.followups += Number(step.followup);
    await checkMeter(run.config);
    run.persist();
  }
}
async function dailySchedules(run: Replay, now: Date) {
  const localDate = now.toISOString().slice(0, 10);
  const calendarReaderFor = () => syntheticCalendar();
  await generateMorningAgenda({ ownerUserId, localDate, now, calendarReaderFor });
  await generatePostMeetingAftercare({ ownerUserId, now, calendarReaderFor });
  await generateBirthdayGiftPlanning({ ownerUserId, localDate, now });
  run.result.scheduledChecks += 3;
}
function assertSettled(turn: EveEvalTurn) {
  turn.expectOk();
  if (turn.inputRequests.length)
    throw new Error("Unresolved input request; preserve partial sample");
  if (turn.toolCalls.some((call) => call.status !== "completed"))
    throw new Error("Tool did not complete; preserve partial sample");
}
function validateActivity(run: Replay) {
  const storage = finishedStorage(run.result.storage);
  if (run.config.smoke) return;
  if (run.config.days === 2) validateCanary(run.result, storage.counts);
  else validateCounts(storage.counts, run.config.workload);
}
function finishedStorage(storage: Progress["storage"]) {
  if (!storage) throw new Error("Missing stored activity");
  if (storage.unfinishedBackgroundJobs !== 0) throw new Error("Unfinished background jobs");
  return storage;
}
function validateCanary(result: Progress, counts: Record<string, number>) {
  validateCounts(counts, { turns: 40, captures: 20, people: 150, followups: 25, uploads: 2 });
  const keys = ["turns", "captures", "followups", "uploads", "scheduledChecks"] as const;
  const expected = [40, 20, 25, 2, 6];
  if (keys.some((key, index) => result[key] !== expected[index]))
    throw new Error("Canary activity is incomplete");
}

function validateCounts(counts: Record<string, number>, workload: Workload) {
  const expected = {
    people: workload.people,
    source_records: workload.captures,
    memories: Math.ceil(workload.captures / 4),
    followups: workload.followups,
    asset_evidence_files: workload.uploads,
  };
  if (Object.entries(expected).some(([key, value]) => !((counts[key] ?? 0) >= value)))
    throw new Error("Persisted activity is incomplete");
}
