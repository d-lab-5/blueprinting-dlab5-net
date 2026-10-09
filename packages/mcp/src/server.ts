import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "./tools.js";

/**
 * An MCP server over a set of tools, the same whichever transport carries it.
 *
 * Errors come back as content rather than being thrown, so the agent sees the
 * reason and can act on it: a conflict means "read again and reapply".
 */
export function buildServer(tools: Tool[]): McpServer {
  const server = new McpServer({ name: "archimate", version: "0.1.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args: Record<string, unknown>) => {
        try {
          return { content: [{ type: "text" as const, text: await tool.run(args) }] };
        } catch (err) {
          return {
            content: [
              { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
            ],
            isError: true,
          };
        }
      }
    );
  }
  return server;
}
