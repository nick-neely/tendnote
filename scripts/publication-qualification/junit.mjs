/**
 * A deliberately strict JUnit reader. The deterministic gate must not accept a
 * report whose aggregate attributes disagree with its own testcase elements, so
 * every count is recomputed from the elements and compared with what the file
 * claims. Anything unparseable is a structural error, never a silent zero.
 */

const TESTCASE_PATTERN = /<testcase\b[^>]*(?:\/>|>[\s\S]*?<\/testcase\s*>)/g;
const OUTCOME_PATTERN =
  /<(failure|flakyFailure|error|skipped)\b[^>]*(?:\/>|>[\s\S]*?<\/(?:failure|flakyFailure|error|skipped)\s*>)/g;

function xmlAttributes(tag, errors, label) {
  const match = tag.match(/^<[^\s>]+\b([^>]*)>$/);
  if (!match) {
    errors.push(`${label} has an invalid opening tag.`);
    return {};
  }
  const attributes = {};
  const source = match[1].replace(/\/\s*$/, "");
  const attributePattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
  let cursor = 0;
  for (const attribute of source.matchAll(attributePattern)) {
    if (source.slice(cursor, attribute.index).trim())
      errors.push(`${label} contains malformed attributes.`);
    const [, name, value] = attribute;
    if (Object.hasOwn(attributes, name)) errors.push(`${label} duplicates attribute ${name}.`);
    attributes[name] = value;
    cursor = attribute.index + attribute[0].length;
  }
  if (source.slice(cursor).trim()) errors.push(`${label} contains malformed attributes.`);
  return attributes;
}

/** Locate the single `testsuite` root, rejecting anything outside it. */
function suiteBounds(xml, errors) {
  const openings = [...xml.matchAll(/<testsuite\b[^>]*>/g)];
  const closings = [...xml.matchAll(/<\/testsuite\s*>/g)];
  if (openings.length !== 1 || closings.length !== 1) {
    errors.push("JUnit must contain exactly one testsuite element.");
    return null;
  }
  const opening = openings[0][0];
  const closing = closings[0];
  const prefix = xml.slice(0, openings[0].index).replace(/^\s*<\?xml[^?]*\?>\s*$/s, "");
  const suffix = xml.slice(closing.index + closing[0].length).trim();
  if (prefix.trim() || suffix) errors.push("JUnit has content outside its testsuite root.");
  return {
    opening,
    body: xml.slice(openings[0].index + opening.length, closing.index),
  };
}

/** Read one non-negative integer attribute, or null when it cannot be trusted. */
function suiteNumber(attributes, name, errors, required) {
  if (!Object.hasOwn(attributes, name)) {
    if (required) errors.push(`JUnit testsuite is missing ${name}.`);
    return required ? null : 0;
  }
  if (!/^\d+$/.test(attributes[name])) {
    errors.push(`JUnit ${name} must be a non-negative integer.`);
    return null;
  }
  return Number(attributes[name]);
}

function declaredCounts(opening, errors) {
  const attributes = xmlAttributes(opening, errors, "JUnit testsuite");
  return {
    tests: suiteNumber(attributes, "tests", errors, true),
    failures: suiteNumber(attributes, "failures", errors, true),
    skipped: suiteNumber(attributes, "skipped", errors, true),
    errors: suiteNumber(attributes, "errors", errors, false),
  };
}

function recordTestcaseId(attributes, ids, errors) {
  const id = attributes.name;
  if (typeof id !== "string" || id.length === 0) {
    errors.push("JUnit testcase is missing name.");
    return null;
  }
  if (ids.includes(id)) {
    errors.push(`JUnit duplicates testcase ${id}.`);
    return id;
  }
  ids.push(id);
  return id;
}

function recordTestcaseOutcome(testcase, openTag, openEnd, id, outcomes, errors) {
  const selfClosing = /\/\s*>$/.test(openTag);
  const inner = selfClosing ? "" : testcase.slice(openEnd + 1, testcase.lastIndexOf("</testcase"));
  const testcaseOutcomes = [...inner.matchAll(OUTCOME_PATTERN)];
  if (inner.replace(OUTCOME_PATTERN, "").trim())
    errors.push(`JUnit testcase ${id || "<unnamed>"} has unexpected content.`);
  if (testcaseOutcomes.length > 1)
    errors.push(`JUnit testcase ${id || "<unnamed>"} has multiple outcomes.`);
  if (testcaseOutcomes.length === 1) outcomes[testcaseOutcomes[0][1]] += 1;
}

/** Recompute IDs and outcomes from the testcase elements themselves. */
function scanTestcases(body, errors) {
  const ids = [];
  const outcomes = { failure: 0, flakyFailure: 0, error: 0, skipped: 0 };
  let cursor = 0;
  for (const match of body.matchAll(TESTCASE_PATTERN)) {
    if (body.slice(cursor, match.index).trim()) errors.push("JUnit has non-testcase content.");
    const testcase = match[0];
    const openEnd = testcase.indexOf(">");
    const openTag = testcase.slice(0, openEnd + 1);
    const attributes = xmlAttributes(openTag, errors, "JUnit testcase");
    const id = recordTestcaseId(attributes, ids, errors);
    recordTestcaseOutcome(testcase, openTag, openEnd, id, outcomes, errors);
    cursor = match.index + testcase.length;
  }
  if (body.slice(cursor).trim()) errors.push("JUnit has content outside testcase elements.");
  return { ids, outcomes };
}

function countsAgree(declared, ids, outcomes) {
  if (
    declared.tests === null ||
    declared.failures === null ||
    declared.skipped === null ||
    declared.errors === null
  )
    return false;
  const observedPassed = ids.length - outcomes.failure - outcomes.skipped - outcomes.error;
  return (
    declared.tests === ids.length &&
    declared.failures === outcomes.failure &&
    declared.skipped === outcomes.skipped &&
    declared.errors === outcomes.error &&
    declared.tests - declared.failures - declared.skipped - declared.errors === observedPassed
  );
}

/**
 * Returns null only for a non-string input; every other problem is reported
 * through `structuralErrors` so the caller blocks rather than guesses.
 */
export function junitCounts(xml) {
  if (typeof xml !== "string") return null;
  const structuralErrors = [];
  const bounds = suiteBounds(xml, structuralErrors);
  if (!bounds)
    return { tests: null, failures: null, skipped: null, errors: null, ids: [], structuralErrors };

  const declared = declaredCounts(bounds.opening, structuralErrors);
  const { ids, outcomes } = scanTestcases(bounds.body, structuralErrors);
  if (outcomes.flakyFailure > 0)
    structuralErrors.push("JUnit contains flakyFailure recovery evidence.");
  if (!countsAgree(declared, ids, outcomes))
    structuralErrors.push("JUnit aggregate counts disagree with testcase elements.");
  return { ...declared, ids, structuralErrors };
}
