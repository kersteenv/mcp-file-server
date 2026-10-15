import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  classify,
  guardOverwrite,
  guardDelete,
  guardGitDir,
  checkLogEntry,
  checkContent,
  GuardError,
} from "./guards.js";

let tmp: string;
let root: string;
const at = (p: string) => path.join(root, p);
const blocked = (fn: () => Promise<void> | void) =>
  assert.rejects(async () => fn(), GuardError);

before(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "guards-")));
  root = path.join(tmp, "ws");
  await fs.mkdir(path.join(root, "notes"), { recursive: true });
  for (const f of [
    "PLAN_LOG.md",
    "CHECKPOINTS.md",
    "DECISIONS.md",
    "PROJECT_STATE.md",
  ]) {
    await fs.writeFile(at(f), "x");
  }
  await fs.writeFile(at("notes/a.txt"), "x");
  await fs.link(at("PLAN_LOG.md"), at("notes/alias.md")); // hard link to a protected file
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test("classifies the three log files as append-only", async () => {
  for (const f of ["PLAN_LOG.md", "CHECKPOINTS.md", "DECISIONS.md"]) {
    assert.equal(await classify(root, at(f)), "append-only");
  }
});
test("classifies PROJECT_STATE.md as state", async () => {
  assert.equal(await classify(root, at("PROJECT_STATE.md")), "state");
});
test("matching is case-insensitive", async () => {
  assert.equal(await classify(root, at("plan_log.md")), "append-only");
});
test("ordinary files are not protected", async () => {
  assert.equal(await classify(root, at("notes/a.txt")), null);
  assert.equal(await classify(root, at("brand-new.txt")), null);
});
test("a hard link to a log file is still protected", async () => {
  assert.equal(await classify(root, at("notes/alias.md")), "append-only");
});

test("guardOverwrite blocks append-only files, including via the hard link", async () => {
  await blocked(() => guardOverwrite(root, at("PLAN_LOG.md")));
  await blocked(() => guardOverwrite(root, at("plan_log.md")));
  await blocked(() => guardOverwrite(root, at("notes/alias.md")));
});
test("guardOverwrite allows PROJECT_STATE.md and ordinary files", async () => {
  await guardOverwrite(root, at("PROJECT_STATE.md"));
  await guardOverwrite(root, at("notes/a.txt"));
});

test("guardDelete blocks all four handoff files", async () => {
  for (const f of [
    "PLAN_LOG.md",
    "CHECKPOINTS.md",
    "DECISIONS.md",
    "PROJECT_STATE.md",
  ]) {
    await blocked(() => guardDelete(root, at(f)));
  }
});
test("guardDelete allows ordinary files", async () => {
  await guardDelete(root, at("notes/a.txt"));
});

test("guardGitDir blocks .git and its Windows spellings", async () => {
  for (const p of [
    ".git/hooks/pre-commit",
    ".GIT./config",
    ".git /x",
    "GIT~1/x",
    "notes/.git/x",
    "notes/a.txt:stream",
  ]) {
    await blocked(() => guardGitDir(root, at(p)));
  }
});
test("guardGitDir allows lookalike names", async () => {
  for (const p of [".gitignore", "notes/git.txt", "digit/x"]) {
    await guardGitDir(root, at(p));
  }
});

test("checkLogEntry accepts well-formed entries", () => {
  checkLogEntry("- [2026-10-16] [session-1] DONE: something");
  checkLogEntry("- [2026-10-16] [s1] one\n- [2026-10-17] [s2] two\n");
});
test("checkLogEntry rejects malformed entries", () => {
  for (const bad of [
    "just text",
    "- [2026-10-16] [s]",
    "- [10-16-2026] [s] x",
    "",
    "- [2026-10-16] [s] ok\nnot an entry",
  ]) {
    assert.throws(() => checkLogEntry(bad), GuardError);
  }
});

test("checkContent rejects null bytes", () => {
  assert.throws(() => checkContent("a\0b"), GuardError);
  checkContent("normal text");
});
