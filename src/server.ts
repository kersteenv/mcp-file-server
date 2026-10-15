import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { resolveSafe } from "./sandbox.js";
import {
  classify,
  guardOverwrite,
  guardDelete,
  guardGitDir,
  checkContent,
  checkLogEntry,
} from "./guards.js";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.resolve(process.cwd(), "workspace");
const MAX_BYTES = 1_000_000; // 1 MB cap on reads and writes

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const ok = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
});

// Returns the error to the client as a tool error, with the real disk path masked.
const fail = (e: unknown): ToolResult => {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [
      { type: "text", text: `Error: ${msg.split(ROOT).join("<workspace>")}` },
    ],
    isError: true,
  };
};

const execFileP = promisify(execFile);
// Runs git with fixed arguments (no shell). Identity is passed per call, so no config is written.
async function git(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP(
      "git",
      [
        "-c",
        "user.name=mcp-file-server",
        "-c",
        "user.email=agent@mcp-file-server.local",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        "-C",
        ROOT,
        ...args,
      ],
      {
        timeout: 15_000,
        maxBuffer: 1_000_000,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    return stdout.trim();
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(
      `git failed: ${(err.stderr || err.message).trim().split("\n")[0]}`,
    );
  }
}

// Create the workspace's own repo on first use (never fall through to the project repo).
async function ensureRepo(): Promise<void> {
  try {
    await fs.stat(path.join(ROOT, ".git"));
  } catch {
    await git(["init"]);
  }
}

function createServer(): McpServer {
  const server = new McpServer({ name: "mcp-file-server", version: "0.2.0" });

  server.registerTool(
    "list_files",
    {
      title: "List files",
      description:
        "List files and folders inside the workspace. Path is relative to the workspace root.",
      inputSchema: {
        path: z
          .string()
          .default(".")
          .describe("Folder to list, relative to the workspace root"),
      },
    },
    async ({ path: dir }) => {
      try {
        const full = await resolveSafe(ROOT, dir);
        const entries = await fs.readdir(full, { withFileTypes: true });
        const lines = entries.map((e) =>
          e.isDirectory() ? `[dir]  ${e.name}` : `[file] ${e.name}`,
        );
        return ok(lines.join("\n") || "(empty folder)");
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "read_file",
    {
      title: "Read file",
      description:
        "Read a UTF-8 text file from the workspace. Path is relative to the workspace root.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("File to read, relative to the workspace root"),
      },
    },
    async ({ path: file }) => {
      try {
        const full = await resolveSafe(ROOT, file);
        const st = await fs.stat(full);
        if (!st.isFile()) throw new Error("Not a file");
        if (st.size > MAX_BYTES)
          throw new Error(
            `File too large (${st.size} bytes, max ${MAX_BYTES})`,
          );
        return ok(await fs.readFile(full, "utf8"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "write_file",
    {
      title: "Write file",
      description:
        "Create or overwrite a UTF-8 text file in the workspace. Missing parent folders are created. Path is relative to the workspace root.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("File to write, relative to the workspace root"),
        content: z.string().describe("Full text content of the file"),
      },
    },
    async ({ path: file, content }) => {
      try {
        const bytes = Buffer.byteLength(content, "utf8");
        if (bytes > MAX_BYTES)
          throw new Error(
            `Content too large (${bytes} bytes, max ${MAX_BYTES})`,
          );
        const full = await resolveSafe(ROOT, file);
        checkContent(content);
        await guardOverwrite(ROOT, full);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, "utf8");
        return ok(`Wrote ${bytes} bytes to ${file}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "str_replace",
    {
      title: "Replace text in file",
      description:
        "Replace exactly one occurrence of old_string with new_string in a file. Fails if old_string is not found or appears more than once, so include enough surrounding context to make it unique.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("File to edit, relative to the workspace root"),
        old_string: z
          .string()
          .min(1)
          .describe("Exact text to find (must match exactly once)"),
        new_string: z
          .string()
          .describe("Replacement text (may be empty to delete the match)"),
      },
    },
    async ({ path: file, old_string, new_string }) => {
      try {
        const full = await resolveSafe(ROOT, file);
        const st = await fs.stat(full);
        if (!st.isFile()) throw new Error("Not a file");
        if (st.size > MAX_BYTES)
          throw new Error(
            `File too large (${st.size} bytes, max ${MAX_BYTES})`,
          );
        checkContent(new_string);
        await guardOverwrite(ROOT, full);
        const text = await fs.readFile(full, "utf8");

        const first = text.indexOf(old_string);
        if (first === -1) throw new Error("old_string not found in file");
        if (text.indexOf(old_string, first + old_string.length) !== -1) {
          throw new Error(
            "old_string appears more than once; add more surrounding context",
          );
        }

        const updated =
          text.slice(0, first) +
          new_string +
          text.slice(first + old_string.length);
        const bytes = Buffer.byteLength(updated, "utf8");
        if (bytes > MAX_BYTES)
          throw new Error(
            `Result too large (${bytes} bytes, max ${MAX_BYTES})`,
          );
        await fs.writeFile(full, updated, "utf8");
        return ok(`Replaced 1 occurrence in ${file}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_file",
    {
      title: "Delete file",
      description:
        "Delete a single file in the workspace. Folders and the workspace root cannot be deleted.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("File to delete, relative to the workspace root"),
      },
    },
    async ({ path: file }) => {
      try {
        const full = await resolveSafe(ROOT, file);
        const st = await fs.stat(full);
        if (!st.isFile())
          throw new Error("Not a file (folders cannot be deleted)");
        await guardDelete(ROOT, full);
        await fs.unlink(full);
        return ok(`Deleted ${file}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "search_text",
    {
      title: "Search text in files",
      description:
        "Search file contents in the workspace for a literal text string (not a regex). Returns matches as 'path:line: text'. Skips binary files, symlinks, node_modules and .git. Stops after 100 matches.",
      inputSchema: {
        query: z.string().min(1).describe("Literal text to look for"),
        path: z
          .string()
          .default(".")
          .describe("Folder to search, relative to the workspace root"),
        case_sensitive: z
          .boolean()
          .default(false)
          .describe("Match case exactly (default false)"),
      },
    },
    async ({ query, path: dir, case_sensitive }) => {
      try {
        const start = await resolveSafe(ROOT, dir);
        if (!(await fs.stat(start)).isDirectory())
          throw new Error("Not a folder");

        const realRoot = await fs.realpath(ROOT);
        const needle = case_sensitive ? query : query.toLowerCase();
        const MAX_MATCHES = 100;
        const MAX_FILES = 2000;
        const SKIP = new Set(["node_modules", ".git"]);
        const results: string[] = [];
        let scanned = 0;
        let truncated = false;

        async function walk(d: string): Promise<void> {
          const entries = await fs.readdir(d, { withFileTypes: true });
          entries.sort((a, b) => a.name.localeCompare(b.name));
          for (const e of entries) {
            if (truncated) return;
            if (e.isSymbolicLink() || SKIP.has(e.name)) continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
              await walk(p);
              continue;
            }
            if (!e.isFile()) continue;
            if (scanned >= MAX_FILES) {
              truncated = true;
              return;
            }
            scanned++;
            if ((await fs.stat(p)).size > MAX_BYTES) continue;
            const text = await fs.readFile(p, "utf8");
            if (text.includes("\0")) continue;
            const rel = path.relative(realRoot, p).split(path.sep).join("/");
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              const hay = case_sensitive ? lines[i] : lines[i].toLowerCase();
              if (hay.includes(needle)) {
                results.push(
                  `${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`,
                );
                if (results.length >= MAX_MATCHES) {
                  truncated = true;
                  return;
                }
              }
            }
          }
        }

        await walk(start);
        if (results.length === 0) return ok("No matches");
        const note = truncated
          ? "\n(results truncated: narrow your search)"
          : "";
        return ok(results.join("\n") + note);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "append_file",
    {
      title: "Append to file",
      description:
        "Append text to the end of a file (created if missing). PLAN_LOG.md, CHECKPOINTS.md and DECISIONS.md are append-only: every line must look like '- [YYYY-MM-DD] [session] text'. PROJECT_STATE.md is replaced with write_file, not appended. Max 10000 bytes per call.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("File to append to, relative to the workspace root"),
        content: z
          .string()
          .min(1)
          .describe("Text to add at the end of the file"),
      },
    },
    async ({ path: file, content }) => {
      try {
        checkContent(content);
        const bytes = Buffer.byteLength(content, "utf8");
        if (bytes > 10_000)
          throw new Error(
            `Content too large (${bytes} bytes, max 10000 per append)`,
          );
        const full = await resolveSafe(ROOT, file);
        await guardGitDir(ROOT, full);
        const kind = await classify(ROOT, full);
        if (kind === "state")
          throw new Error(
            "PROJECT_STATE.md is replaced, not appended. Use write_file.",
          );
        if (kind === "append-only") checkLogEntry(content);
        let prefix = "";
        try {
          const st = await fs.stat(full);
          if (!st.isFile()) throw new Error("Not a file");
          if (st.size + bytes > MAX_BYTES)
            throw new Error(`File would exceed ${MAX_BYTES} bytes`);
          const existing = await fs.readFile(full, "utf8");
          if (existing.length > 0 && !existing.endsWith("\n")) prefix = "\n";
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          await fs.mkdir(path.dirname(full), { recursive: true });
        }
        const text = prefix + content.replace(/\s+$/, "") + "\n";
        await fs.appendFile(full, text, "utf8");
        return ok(
          `Appended ${Buffer.byteLength(text, "utf8")} bytes to ${file}`,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "git_checkpoint",
    {
      title: "Git checkpoint",
      description:
        "Commit every change in the workspace as one checkpoint with the given message. Returns the short commit hash, or 'Nothing to commit'.",
      inputSchema: {
        message: z
          .string()
          .min(1)
          .max(200)
          .describe("Short commit message describing the state"),
      },
    },
    async ({ message }) => {
      try {
        await ensureRepo();
        await git(["add", "-A"]);
        const status = await git(["status", "--porcelain"]);
        if (!status) return ok("Nothing to commit");
        const changed = status.split("\n").length;
        await git(["commit", "--no-verify", "-m", message.trim()]);
        const hash = await git(["rev-parse", "--short", "HEAD"]);
        return ok(
          `Committed ${hash}: ${message.trim()} (${changed} changed paths)`,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "git_log",
    {
      title: "Git log",
      description:
        "Show the most recent checkpoints (newest first) as 'hash date message'.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("How many checkpoints to show (1-50)"),
      },
    },
    async ({ limit }) => {
      try {
        await ensureRepo();
        try {
          await git(["rev-parse", "--verify", "HEAD"]);
        } catch {
          return ok("No commits yet");
        }
        return ok(
          await git([
            "log",
            `--max-count=${limit}`,
            "--date=short",
            "--pretty=format:%h %ad %s",
          ]),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "2mb" }));

// Stateless Streamable HTTP: a fresh server + transport per request.
app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const notAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
};
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);
await fs.mkdir(ROOT, { recursive: true });

app.listen(PORT, () => {
  console.log(`MCP file server listening on http://localhost:${PORT}/mcp`);
  console.log(`Workspace root: ${ROOT}`);
});
