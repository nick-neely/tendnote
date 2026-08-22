import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Filesystem reads for qualification evidence. Every read walks the path
 * component by component and refuses symlinks, so a bundle cannot point the
 * verifier at bytes outside the directory it claims to describe.
 */

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function secureExistingPath(path) {
  const absolute = resolve(path);
  let current = sep;
  for (const part of absolute.slice(sep.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) throw new Error(`Symlink paths are not accepted: ${current}`);
  }
  return {
    absolute,
    real: realpathSync(absolute),
    stats: lstatSync(absolute),
  };
}

export function secureDirectory(path) {
  const info = secureExistingPath(path);
  if (!info.stats.isDirectory()) throw new Error(`Expected a directory: ${path}`);
  return info;
}

function secureFile(path) {
  const info = secureExistingPath(path);
  if (!info.stats.isFile()) throw new Error(`Expected a regular file: ${path}`);
  return info;
}

export function secureRead(path) {
  secureFile(path);
  return readFileSync(path);
}

/** True when `real` is `parentReal` itself or a descendant of it. */
export function containedBy(real, parentReal) {
  return real === parentReal || real.startsWith(`${parentReal}${sep}`);
}

export function secureChildPath(parent, child, label = "path") {
  const parentInfo = secureDirectory(parent);
  const target = resolve(parentInfo.absolute, child);
  if (target === parentInfo.absolute || !target.startsWith(`${parentInfo.absolute}${sep}`)) {
    throw new Error(`${label} escapes its containing directory: ${child}`);
  }
  const targetInfo = secureExistingPath(target);
  if (!containedBy(targetInfo.real, parentInfo.real)) {
    throw new Error(`${label} resolves outside its containing directory: ${child}`);
  }
  return targetInfo;
}

export function secureBundleFiles(root) {
  const files = [];
  function visit(directory, prefix) {
    secureDirectory(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = secureExistingPath(child);
      if (info.stats.isDirectory()) visit(child, childPrefix);
      else if (info.stats.isFile()) files.push(childPrefix);
      else throw new Error(`Unsupported filesystem entry in evidence bundle: ${childPrefix}`);
    }
  }
  visit(root, "");
  return files;
}

export function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function parseJson(path, blockers) {
  try {
    return JSON.parse(secureRead(path).toString("utf8"));
  } catch (error) {
    blockers.push(`Unable to parse ${path}: ${describeError(error)}`);
    return null;
  }
}

export function readJsonl(path, blockers) {
  try {
    return secureRead(path)
      .toString("utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    blockers.push(`Unable to parse ${path}: ${describeError(error)}`);
    return [];
  }
}
