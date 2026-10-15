import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSafe, SandboxError } from "./sandbox.js";

let tmp: string;
let root: string;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-"));
  root = path.join(tmp, "ws");
  const outside = path.join(tmp, "outside");
  await fs.mkdir(path.join(root, "notes"), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "secret");
  await fs.symlink(outside, path.join(root, "link"), "junction");
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const blocked = (p: string) =>
  assert.rejects(resolveSafe(root, p), SandboxError);

test("allows the root itself", async () => {
  await resolveSafe(root, ".");
});
test("allows existing nested paths", async () => {
  await resolveSafe(root, "notes");
});
test("allows files that don't exist yet", async () => {
  await resolveSafe(root, "notes/new/deeper/file.txt");
});
test("allows names that merely start with two dots", async () => {
  await resolveSafe(root, "..notes.txt");
});
test("rejects ..", () => blocked(".."));
test("rejects ../outside", () => blocked("../outside"));
test("rejects sneaky notes/../../outside", () =>
  blocked("notes/../../outside"));
test("rejects a sibling folder with the same prefix", () =>
  blocked("../ws-evil/x"));
test("rejects absolute paths", () =>
  blocked(path.join(tmp, "outside", "secret.txt")));
test("rejects null bytes", () => blocked("notes\0.txt"));
test("rejects symlink/junction escapes", () => blocked("link/secret.txt"));
test("rejects writing through a symlink to a new file", () =>
  blocked("link/new.txt"));
