#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { connect } from "./backend.js";
import { ALL_TOOLS, METAMODEL_TOOLS } from "./tools.js";

/**
 * An MCP server over an ArchiMate model.
 *
 * The spec's original motivation: give LLM agents a shared architectural
 * memory rather than a folder of stale diagrams. What makes that work is not
 * only read access to the model — it is read access to the *specification*, so
 * an agent can ask what ArchiMate permits instead of guessing at it.
 *
 * stdio, not HTTP. The server runs beside the agent that uses it, which means
 * no endpoint to secure, no token to park somewhere, and iteration on the tool
 * surface costs a restart rather than a deploy. A hosted transport is the
 * obvious next step once the tools have settled.
 *
 * Configuration, all environment:
 *
 *   BP_USER, BP_PASSWORD   Cognito credentials. Without them the server still
 *                          starts and serves the metamodel tools, which need
 *                          no backend at all — useful for asking ArchiMate
 *                          questions with no project to hand.
 *   BP_OUTPUTS             Path to amplify_outputs.json. Defaults to
 *                          backend/amplify_outputs.json relative to the repo.
 *
 * Registered in Claude Code with:
 *   claude mcp add archimate -- node <repo>/packages/mcp/dist/index.js
 */

async function main() {
  const outputsPath = resolve(
    process.env.BP_OUTPUTS ??
      resolve(import.meta.dirname, "../../../backend/amplify_outputs.json")
  );
  const username = process.env.BP_USER;
  const password = process.env.BP_PASSWORD;

  let connected = false;
  let reason = "";

  if (!username || !password) {
    reason = "BP_USER and BP_PASSWORD are not set";
  } else if (!existsSync(outputsPath)) {
    reason = `no amplify_outputs.json at ${outputsPath}`;
  } else {
    try {
      await connect({ outputsPath, username, password });
      connected = true;
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
  }

  // Degrading to metamodel-only rather than exiting is deliberate. An agent
  // asking "can a Work Package realize a Deliverable?" needs no credentials,
  // and a server that refuses to start over a missing password would take
  // that away too.
  const tools = connected ? ALL_TOOLS : METAMODEL_TOOLS;

  // stdout is the protocol channel; anything written there that is not JSON-RPC
  // corrupts the session. Diagnostics go to stderr.
  if (!connected) {
    console.error(
      `[archimate-mcp] not connected to a backend (${reason}). ` +
        `Serving ${tools.length} metamodel tools only.`
    );
  } else {
    console.error(
      `[archimate-mcp] connected as ${username}. Serving ${tools.length} tools.`
    );
  }

  const server = new McpServer({
    name: "archimate",
    version: "0.1.0",
  });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args: Record<string, unknown>) => {
        try {
          return { content: [{ type: "text" as const, text: await tool.run(args) }] };
        } catch (err) {
          // Returned as content rather than thrown, so the agent sees the
          // reason and can choose what to do — a conflict means "read again
          // and reapply", which it can act on.
          return {
            content: [
              {
                type: "text" as const,
                text: err instanceof Error ? err.message : String(err),
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[archimate-mcp]", err);
  process.exit(1);
});
