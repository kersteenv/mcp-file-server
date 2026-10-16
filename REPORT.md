# Report: MCP File-Server Connector

## 1. Stack and why

| Layer           | Choice                                                          | Why                                                                                        |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Runtime / SDK   | Node.js + official TypeScript MCP SDK                           | The reference SDK; closest to the spec, so fewer surprises than a third-party wrapper      |
| Transport       | Streamable HTTP, stateless (new server + transport per request) | Works through a tunnel and behind a process manager; no session state to lose on a restart |
| Validation      | Zod schema on every tool input                                  | Bad input is rejected before it reaches the filesystem                                     |
| Exposure        | ngrok with a static domain                                      | The URL stays the same across restarts, so the client config never changes                 |
| Process manager | PM2                                                             | Restarts crashed processes; one config file runs both the server and the tunnel            |
| Testing         | MCP Inspector, then a real client                               | The Inspector is for debugging; a real agent shows how tools behave in use                 |

Trade-off: stateless mode is simple and robust, but it can't support server-initiated messages or resumable sessions. A file server doesn't need either. I would pick this stack again because combining Node.js/TypeScript with Zod validation, PM2, and ngrok provided a lightweight, highly predictable setup that made sandboxing and background execution straightforward to manage and debug.

## 2. Tool design choices

Nine tools: `list_files`, `read_file`, `write_file`, `str_replace`, `delete_file`, `search_text`, `append_file`, `git_checkpoint`, `git_log`.

- **`str_replace` requires exactly one match.** A missing or ambiguous target fails loudly and tells the agent to add context, which stops silent wrong-place edits. It uses string slicing rather than `String.replace`, which would mangle text containing `$&`.
- **`search_text` is literal, not regex.** This removes slow-pattern abuse and keeps the tool predictable. It skips symlinks and binaries and stops at 100 matches.
- **`append_file` exists for the logs.** Append-only handoff logs need an append operation, or agents would have to rewrite them and could lose history.
- **`git_checkpoint` commits everything.** One call gives a clean undo point, with no staging decisions for the agent to get wrong.
- **Errors come back as tool errors** (`isError`), so the agent can read them and recover. Real disk paths are masked as `<workspace>`.
- **Size limits** (1 MB files, 10 KB appends) keep one bad call from filling memory or disk.

## 3. Handoff protocol

`PROJECT_STATE.md` (rewritten each session), plus the append-only `PLAN_LOG.md`, `CHECKPOINTS.md` and `DECISIONS.md`. The rules are enforced in code, not left as instructions: the logs reject `write_file` and `str_replace`, entries must match `[YYYY-MM-DD] [session] text`, and none of the four files can be deleted. The checks cover case differences and hard links.

## 4. Security tradeoffs

**What is protected**

- Sandbox root: lexical check plus `realpath` on the deepest existing part of the path, so `..`, absolute paths, null bytes, symlinks and junctions can't escape. 12 tests.
- Handoff guards and `.git` lockdown: 14 tests. Git hooks run code at commit time, so the `.git` folder is blocked for all file tools (including `.GIT.` and `GIT~1`). Git runs without a shell, with fixed arguments and `--no-verify`.

**What is not protected**

- **No authentication.** Anyone with the public URL can call every tool, including write and delete. This is the biggest weakness. Mitigation: no sensitive data in the workspace, and stop the tunnel when it isn't in use. The next step would be token auth.
- **Check-then-use race.** A path is validated and used a moment later, so someone with local access could swap a symlink in between. Remote agents have no tool for creating symlinks.
- **Prompt injection through file contents.** An agent reading a file may follow instructions hidden in it. The sandbox limits the damage but doesn't prevent it.
- **No rate limiting; one shared workspace.**
- PM2 doesn't restart at boot on Windows without extra setup.

## 5. Results of the two-session run

The task was a four-section study guide in the workspace, split across sessions.

- **Session 1** wrote the README, sections 01 and 02, and the state file. The Claude.ai connector had cached an older 6-tool list, so the agent had no `append_file` or git tools. The append-only guard refused its `write_file` attempts on the logs, and it recorded the blocker in `PROJECT_STATE.md` instead of working around it.
- **Fix:** I removed and re-added the connector. **Session 1b** then wrote the missing log entries and checkpoint.
- **Session 2** started in a fresh chat with only the handoff files and finished sections 03 and 04, updated the README with `str_replace`, deleted the scratch file, verified with `search_text`, and committed. The final section lengths were 163 to 167 words each.

Clients: the MCP Inspector (local and over HTTPS) and a Claude.ai custom connector. Claude Code needs a paid plan. VS Code's MCP client showed an error that I didn't diagnose, because the connector route worked first.

Status: the server and tunnel were deployed and tested over HTTPS, then stopped after testing. The README explains how to start them again. What surprised me most was how Claude.ai cached the initial 6-tool schema until the connector was re-added, as well as how PM2’s background daemon on Windows continued auto-respawning process windows when closed until explicitly cleared via `pm2 kill`.

## 6. What I would do next

Token auth, `if_version` locking so concurrent agents can't overwrite each other, and a repo map tool.
