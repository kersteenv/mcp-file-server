import fs from "node:fs/promises";
import path from "node:path";

export class GuardError extends Error {}

const APPEND_ONLY = ["PLAN_LOG.md", "CHECKPOINTS.md", "DECISIONS.md"];
const PROTECTED = [...APPEND_ONLY, "PROJECT_STATE.md"];

export type Kind = "append-only" | "state" | null;

// Which handoff file (if any) does this resolved path point at?
// Checks the name (case-insensitive, like Windows) and the file identity,
// so odd spellings or hard links can't sneak past.
async function protectedName(
  root: string,
  full: string,
): Promise<string | null> {
  const realRoot = await fs.realpath(root);
  const rel = path.relative(realRoot, full).toLowerCase();
  for (const name of PROTECTED) {
    if (rel === name.toLowerCase()) return name;
  }
  try {
    const target = await fs.stat(full, { bigint: true });
    for (const name of PROTECTED) {
      try {
        const p = await fs.stat(path.join(realRoot, name), { bigint: true });
        if (p.ino !== 0n && p.ino === target.ino && p.dev === target.dev)
          return name;
      } catch {
        /* protected file missing: nothing to compare */
      }
    }
  } catch {
    /* target doesn't exist yet */
  }
  return null;
}

export async function classify(root: string, full: string): Promise<Kind> {
  const name = await protectedName(root, full);
  if (!name) return null;
  return APPEND_ONLY.includes(name) ? "append-only" : "state";
}

// Agents must never touch the workspace's .git folder (hooks would run code).
// Also catches Windows tricks: ".git.", ".git ", "GIT~1", and ":" stream syntax.
export async function guardGitDir(root: string, full: string): Promise<void> {
  const realRoot = await fs.realpath(root);
  const rel = path.relative(realRoot, full);
  for (const seg of rel.split(path.sep)) {
    const n = seg.replace(/[. ]+$/, "").toLowerCase();
    if (n === ".git" || /^git~\d+$/.test(n) || seg.includes(":")) {
      throw new GuardError("The .git folder is off limits.");
    }
  }
}

export async function guardOverwrite(
  root: string,
  full: string,
): Promise<void> {
  await guardGitDir(root, full);
  if ((await classify(root, full)) === "append-only") {
    throw new GuardError(
      "This file is append-only. Use append_file to add an entry.",
    );
  }
}

export async function guardDelete(root: string, full: string): Promise<void> {
  await guardGitDir(root, full);
  if (await classify(root, full)) {
    throw new GuardError("Handoff files cannot be deleted.");
  }
}

export function checkContent(text: string): void {
  if (text.includes("\0")) throw new GuardError("Content contains a null byte");
}

const ENTRY = /^-\s+\[\d{4}-\d{2}-\d{2}\]\s+\[[^\]]+\]\s+\S/;

export function checkLogEntry(content: string): void {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0 || !lines.every((l) => ENTRY.test(l))) {
    throw new GuardError(
      "Log entries must look like: - [YYYY-MM-DD] [session] text (one per line)",
    );
  }
}
