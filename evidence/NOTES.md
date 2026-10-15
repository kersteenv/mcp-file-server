# Evidence notes

- transcript-session-1.md: the agent had only 6 of the 9 tools because the Claude.ai connector cached the old tool list. The append-only guard refused write_file on PLAN_LOG.md, and the agent recorded the blocker in PROJECT_STATE.md instead of working around it.
- transcript-session-1b.md: after removing and re-adding the connector, the agent finished the bookkeeping with append_file and git_checkpoint.
- transcript-session-2.md: a fresh chat with no memory finished the guide using only the handoff files.
- workspace-git-log.txt: the checkpoint history of the workspace.
- workspace-snapshot/: the final workspace contents.
