# Tools and Schemas

A tool is a named operation a server offers to the model. Each tool is described by three main fields: a name, a human-readable description, and an input schema written in JSON Schema. The description tells the model when to use the tool, and the schema tells it exactly what arguments are valid.

For example, a file tool might be called read_file and require one string property named path. The schema marks path as required, so a call without it is rejected before any code runs. Types, enums, minimum lengths, and defaults can all be declared, which narrows the space of mistakes the model can make.

Good schemas are small and precise. Prefer clear property names, short descriptions that state units and formats, and strict validation over loose free-form text. Tool results come back as content blocks, and errors should be returned with a clear message so the model can correct its next attempt instead of repeating the failure.
