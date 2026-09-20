export type Workload = {
  turns: number;
  captures: number;
  people: number;
  followups: number;
  uploads: number;
};

export function replayPersonName(index: number) {
  // Equal-length alphabetic names avoid numeric-prefix matches (1 vs 10) and
  // fit Capture's explicit-person grammar. All 150 fixture names are unique.
  return `Avery ${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}ley`;
}

export function plannedTurn(
  workload: Workload,
  index: number,
  person: { id: string; displayName: string },
  now: Date,
) {
  const previousCaptures = Math.floor((index * workload.captures) / workload.turns);
  const captureCount = Math.floor(((index + 1) * workload.captures) / workload.turns);
  const capture = captureCount > previousCaptures;
  const explicit = capture && previousCaptures % 4 === 0;
  const groupedCount = Math.min(Math.ceil(workload.captures / 4), workload.followups);
  const standaloneCount = workload.followups - groupedCount;
  if (standaloneCount > workload.turns - workload.captures)
    throw new Error("Not enough non-capture turns for standalone follow-ups");
  const followup = capture
    ? explicit && Math.floor(previousCaptures / 4) < groupedCount
    : index - previousCaptures < standaloneCount;
  const due = new Date(now.getTime() + 3 * 86400000);
  const dueDate = due.toISOString().slice(0, 10);
  const timing = due.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const reminder = `Remind me to follow up with ${person.displayName} on ${timing}`;
  let prompt: string;
  if (explicit) {
    prompt = `Remember that ${person.displayName} enjoys pottery from our fictional picnic conversation ${index + 1}`;
    if (followup) prompt += `; ${reminder}`;
  } else if (capture) {
    prompt = `I caught up with ${person.displayName}. They mentioned enjoying pottery during our fictional picnic conversation ${index + 1}. Log this as a private casual relationship note, not a confirmed memory.`;
  } else if (followup) {
    prompt = reminder;
  } else {
    prompt = `What relationship context do I have for ${person.displayName}? Give a short grounded answer and one possible next step. Do not write anything.`;
  }
  return { prompt, personId: person.id, capture, explicit, followup, dueDate };
}
export type PlannedTurn = ReturnType<typeof plannedTurn>;

export function dayIndices(day: number, total: number) {
  const start = Math.floor((day * total) / 30);
  return Array.from({ length: Math.floor(((day + 1) * total) / 30) - start }, (_, i) => start + i);
}
