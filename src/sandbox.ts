import fs from "node:fs/promises";
import path from "node:path";

export class SandboxError extends Error {}

// True if target is root itself or something inside it.
function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false; // different drive on Windows
  return rel !== ".." && !rel.startsWith(".." + path.sep);
}

/**
 * Resolve a user-supplied path against the workspace root.
 * Throws SandboxError if the result would land outside the root,
 * either by "..", an absolute path, or a symlink/junction.
 */
export async function resolveSafe(
  rootDir: string,
  userPath: string,
): Promise<string> {
  if (userPath.includes("\0")) throw new SandboxError("Invalid path");

  const root = await fs.realpath(path.resolve(rootDir));
  const full = path.resolve(root, userPath);

  // 1. Lexical check: catches "..", "C:\\Windows", etc.
  if (!isInside(root, full)) {
    throw new SandboxError(`Path escapes workspace: ${userPath}`);
  }

  // 2. Symlink check: the deepest part of the path that exists
  //    must really live inside the root.
  let probe = full;
  while (true) {
    try {
      const real = await fs.realpath(probe);
      if (!isInside(root, real)) {
        throw new SandboxError(`Path escapes workspace via link: ${userPath}`);
      }
      break;
    } catch (e) {
      if (e instanceof SandboxError) throw e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent; // file doesn't exist yet (e.g. write_file): check its parent
    }
  }

  return full;
}
