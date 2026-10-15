# Sandboxing

An MCP server often runs with real power: it can read files, run commands, or call networks. Sandboxing limits that power so a mistake or a malicious prompt cannot do serious harm. The guiding rule is least privilege: give a server only the access its job requires, and nothing more.

File servers usually confine every path to a workspace root. Paths are resolved first, and any request that escapes the root, through "../" segments or symbolic links, is refused. Network access and shell commands can be restricted the same way, using allowlists of approved hosts and programs rather than trying to block bad ones.

Some actions deserve a human in the loop. Deleting data, sending messages, or making payments can require explicit approval from the host. Servers can also add guards of their own, such as append-only logs that reject edits to old entries. Layered limits matter because no single check is perfect, and each one reduces what a failure can reach.
