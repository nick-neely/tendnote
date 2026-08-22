import {
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { QUALIFICATION_OUTPUT_ROOT } from "./contract.mjs";
import { secureDirectory, secureExistingPath, secureRead } from "./secure-fs.mjs";

/**
 * Write the qualification report atomically and only ever under
 * `evidence/qualification/`. The report is the artifact a publication decision
 * is made from, so a partially written file, a followed symlink, or a path
 * outside that root has to fail rather than produce something readable.
 */

export function readInput(path) {
  return JSON.parse(secureRead(resolve(path)).toString("utf8"));
}

function assertRequestedPath(requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.length === 0)
    throw new Error("Output path is required when --output is supplied.");
  if (isAbsolute(requestedPath) || requestedPath.split(/[\\/]/).includes(".."))
    throw new Error("Output path must be relative and cannot escape the repository.");
}

function assertUnderOutputRoot(repositoryAbsolute, outputPath) {
  const outputRoot = resolve(repositoryAbsolute, QUALIFICATION_OUTPUT_ROOT);
  if (outputPath === outputRoot || !outputPath.startsWith(`${outputRoot}${sep}`))
    throw new Error(`Output path must remain under ${QUALIFICATION_OUTPUT_ROOT}.`);
  if (basename(outputPath) === "." || basename(outputPath) === "..")
    throw new Error("Output path must name a report file.");
}

/**
 * Walk the parent chain and collect the directories that do not exist yet.
 * Every component that does exist must already be a real directory: this is
 * where a symlinked parent is caught, before anything is written.
 */
function missingParents(repositoryAbsolute, parent) {
  const missing = [];
  let current = repositoryAbsolute;
  for (const component of relative(repositoryAbsolute, parent).split(sep).filter(Boolean)) {
    current = join(current, component);
    if (missing.length > 0) {
      missing.push(current);
      continue;
    }
    try {
      const info = secureExistingPath(current);
      if (!info.stats.isDirectory())
        throw new Error(`Output component is not a directory: ${current}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing.push(current);
    }
  }
  return missing;
}

function outputLocation(repoRoot, requestedPath) {
  assertRequestedPath(requestedPath);
  const repository = secureDirectory(repoRoot);
  const outputPath = resolve(repository.absolute, requestedPath);
  assertUnderOutputRoot(repository.absolute, outputPath);
  const parent = dirname(outputPath);
  return { outputPath, parent, missing: missingParents(repository.absolute, parent) };
}

/** An existing destination is only acceptable when it is a regular file. */
function assertReplaceableDestination(outputPath) {
  try {
    const existing = secureExistingPath(outputPath);
    if (!existing.stats.isFile())
      throw new Error(`Output path is not a regular file: ${outputPath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function writeAllBytes(descriptor, contents) {
  const bytes = Buffer.from(contents, "utf8");
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
}

/**
 * Write to a fresh `O_EXCL | O_NOFOLLOW` temporary file, fsync it, re-check the
 * destination, then rename. Returns the first error seen so the caller can
 * still run the close and unlink cleanup below.
 */
function writeThroughTemporary(parentAbsolute, temporaryPath, outputPath, contents) {
  let descriptor;
  let operationError;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeAllBytes(descriptor, contents);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    secureDirectory(parentAbsolute);
    assertReplaceableDestination(outputPath);
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    operationError = error;
  }
  return { descriptor, operationError };
}

function closeAndUnlink(descriptor, temporaryPath, operationError) {
  let firstError = operationError;
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch (error) {
      if (firstError === undefined) firstError = error;
    }
  }
  try {
    unlinkSync(temporaryPath);
  } catch (error) {
    if (error?.code !== "ENOENT" && firstError === undefined) firstError = error;
  }
  return firstError;
}

export function writeOutput(repoRoot, requestedPath, contents) {
  const location = outputLocation(repoRoot, requestedPath);
  for (const directory of location.missing) {
    mkdirSync(directory);
    secureDirectory(directory);
  }
  const parent = secureDirectory(location.parent);
  assertReplaceableDestination(location.outputPath);

  const temporaryPath = join(
    parent.absolute,
    `.${basename(location.outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const { descriptor, operationError } = writeThroughTemporary(
    parent.absolute,
    temporaryPath,
    location.outputPath,
    contents,
  );
  const firstError = closeAndUnlink(descriptor, temporaryPath, operationError);
  if (firstError !== undefined) throw firstError;
}
