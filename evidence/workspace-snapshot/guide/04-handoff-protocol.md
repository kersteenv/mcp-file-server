# Handoff Protocol

Long projects often span several sessions, and an agent does not carry memory from one session to the next. A handoff protocol solves this by keeping state in files rather than in chat history. Anything a later session needs to know must be written down before the current one ends.

A simple protocol uses a few fixed files. PROJECT_STATE.md holds the goal, current status, and one precise next action; read it first and update it last. Three append-only logs record the story: PLAN_LOG for intentions, DECISIONS for choices and their reasons, and CHECKPOINTS for what works and how to verify it. Because old entries are never edited, later sessions can trust the history.

Finish each session with a version-control checkpoint so the work can be restored or compared. State the next action concretely enough that a fresh reader could act on it without asking questions. When the project is complete, say so plainly: set the status to complete and the next action to none.
