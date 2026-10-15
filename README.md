# MCP File Server

A sandboxed file-server connector for the Model Context Protocol (MCP). AI agents get 9 tools to read, edit, search and checkpoint files inside one workspace folder, served over HTTPS. A small handoff protocol lets separate agent sessions continue each other's work.

Stack: Node.js + official TypeScript MCP SDK, Streamable HTTP (stateless), Zod validation, PM2, ngrok. Written and tested on Windows (PowerShell).

## What you need

- Node.js 18 or newer (20 or 22 recommended), npm, and git
- PM2: `npm install -g pm2`
- A free ngrok account (for the HTTPS tunnel)

## Quick start (local)

```powershell
git clone <YOUR-REPO-URL> mcp-file-server
cd mcp-file-server
npm install
npm test
npm run dev
```

`npm test` runs 26 tests for the sandbox and guards. `npm run dev` should print `MCP file server listening on http://localhost:3000/mcp`. The workspace folder (`./workspace`) is created on first start.

- Always start the server from the project root: the workspace is `./workspace` relative to the working directory.
- Set the `PORT` environment variable to change the port (default 3000).

## Try it with the MCP Inspector

```powershell
npx @modelcontextprotocol/inspector
```

Choose transport **Streamable HTTP**, URL `http://localhost:3000/mcp`, click **Connect**, then **Tools -> List Tools**. You should see 9 tools.

## Tools

All paths are relative to the workspace root. Text files only (UTF-8, max 1 MB).

| Tool             | What it does                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `list_files`     | List files and folders in a directory                                                        |
| `read_file`      | Read a text file                                                                             |
| `write_file`     | Create or overwrite a file (parent folders are created)                                      |
| `str_replace`    | Replace exactly one occurrence of a string; fails if it is missing or appears more than once |
| `delete_file`    | Delete one file (not folders)                                                                |
| `search_text`    | Literal text search across files (not regex); max 100 matches                                |
| `append_file`    | Append text to a file; enforces the log format on the handoff logs                           |
| `git_checkpoint` | Commit all workspace changes in the workspace's own git repo                                 |
| `git_log`        | Show recent checkpoints                                                                      |

The MCP endpoint is `POST /mcp`. The server is stateless: every request gets a fresh server and transport. `GET` and `DELETE` on `/mcp` return 405.

## Deploy over HTTPS (ngrok + PM2)

1. Install ngrok and register your token (keep it secret, never commit it):
   `ngrok config add-authtoken <YOUR_TOKEN>`
2. In the ngrok dashboard, claim your free static domain (`something.ngrok-free.dev`).
3. Edit the `ngrok-tunnel` entry in `ecosystem.config.cjs`:
   - `script`: the full path to `ngrok.exe` (find it with `(Get-Command ngrok).Source`; write each `\` as `\\`)
   - `args`: replace the domain with yours
4. Start both processes and save the list:

```powershell
   pm2 start ecosystem.config.cjs
   pm2 list
   pm2 save
```

5. Test from outside:

```powershell
   curl.exe -i https://<YOUR-DOMAIN>/mcp
```

Expect `HTTP/1.1 405 Method Not Allowed`. That proves the request reached the server through the tunnel.

PM2 restarts the server and tunnel if they crash. Starting PM2 automatically at boot needs extra setup that this project does not cover.

## Connect a client

Tested with the MCP Inspector and with a Claude.ai custom connector (Settings -> Connectors -> add a custom connector with `https://<YOUR-DOMAIN>/mcp`).

A connector keeps the tool list it saw when it was added. If you add or rename tools later, remove the connector and add it again, or the agent will not see them.

## Handoff protocol

Four Markdown files in the workspace root carry context between agent sessions:

| File               | Purpose                             | Rule (enforced in code)                                                 |
| ------------------ | ----------------------------------- | ----------------------------------------------------------------------- |
| `PROJECT_STATE.md` | Goal, status, next action, blockers | Rewritten each session with `write_file`; cannot be deleted or appended |
| `PLAN_LOG.md`      | What each session plans or has done | Append-only                                                             |
| `CHECKPOINTS.md`   | Safe stopping points                | Append-only                                                             |
| `DECISIONS.md`     | Choices and the reasons             | Append-only                                                             |

Log entries must look like `- [YYYY-MM-DD] [session] text`. The three logs reject `write_file` and `str_replace`, and none of the four files can be deleted. Matching is case-insensitive and also catches hard links to these files.

A session should read `PROJECT_STATE.md` first and update it last.

## Security model

- **Sandbox root.** Every path is resolved against the workspace root. A path is rejected if it leaves the root through `..`, an absolute path, a drive change, or a null byte. The deepest existing part of the path is also resolved with `realpath`, so symlinks and junctions cannot lead outside.
- **Limits.** 1 MB per file, 10 KB per append, 2 MB request body, 100 search matches.
- **No leaked paths.** The real workspace path is masked as `<workspace>` in error messages.
- **Git lockdown.** The `.git` folder is off limits to every file tool, including Windows spellings such as `.GIT.` and `GIT~1`, because git hooks would run code. Commits use `--no-verify`, fixed arguments (no shell), and a per-call identity.
- **Validation.** Every tool input goes through a Zod schema.

## Known limitations

- **No authentication.** Anyone who knows the tunnel URL can call every tool, including `write_file` and `delete_file`. Keep sensitive data out of the workspace and stop the tunnel when it is not in use. Token auth is the obvious next step.
- **Check-then-use race.** A path is checked and then used a moment later. An attacker with local access to the machine could swap a symlink in between. Remote agents cannot create symlinks with these tools.
- **No rate limiting**, and one shared workspace for every caller.
- `git_checkpoint` stages everything in the workspace.

## Project layout

```
src/server.ts        tools and HTTP server
src/sandbox.ts       path-escape guard
src/guards.ts        handoff-file and .git guards
src/*.test.ts        tests (npm test)
ecosystem.config.cjs PM2 config (server + tunnel)
workspace/           the sandbox root (not committed)
evidence/            transcripts and proof of the two-session run
```

## Evidence

`evidence/` holds the chat transcripts of the two-session run, the workspace git log, a snapshot of the final workspace, and `NOTES.md` explaining each file.
