# What Is MCP?

The Model Context Protocol (MCP) is an open standard that lets AI applications connect to outside tools and data in a uniform way. Before MCP, every assistant needed custom code for each service it wanted to reach. MCP replaces that tangle with one shared protocol, much like USB-C replaced many cable types.

MCP uses a client-server design. A host application, such as a chat app or coding assistant, runs one or more clients. Each client keeps a connection to a single server. A server is a small program that exposes capabilities: tools the model can call, resources it can read, and prompts that act as reusable templates.

Messages travel as JSON-RPC over a transport, commonly standard input and output for local servers or HTTP for remote ones. The host stays in control: it decides which servers to connect and what the model may do with them. This separation keeps integrations portable, since one server can serve many different hosts.
