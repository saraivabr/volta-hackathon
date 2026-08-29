import { executeTool, toolDefinitions } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function authorized(request: Request) {
  const expected = process.env.VOLTA_MCP_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

const rpc = (id: RpcRequest["id"], result: unknown, status = 200) =>
  Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { status });

const rpcError = (id: RpcRequest["id"], code: number, message: string, status = 400) =>
  Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });

export async function POST(request: Request) {
  if (!authorized(request)) return rpcError(null, -32001, "Unauthorized", 401);
  let message: RpcRequest;
  try {
    message = (await request.json()) as RpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  try {
    switch (message.method) {
      case "initialize":
        return rpc(message.id, {
          protocolVersion: String(message.params?.protocolVersion ?? "2025-06-18"),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "volta-operations", version: "0.1.0" },
        });
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "ping":
        return rpc(message.id, {});
      case "tools/list":
        return rpc(message.id, { tools: toolDefinitions });
      case "tools/call": {
        const name = String(message.params?.name ?? "");
        const output = await executeTool(name, message.params?.arguments ?? {});
        return rpc(message.id, {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
          isError: false,
        });
      }
      default:
        return rpcError(message.id, -32601, "Method not found");
    }
  } catch (error) {
    return rpc(message.id, {
      content: [{ type: "text", text: error instanceof Error ? error.message : "Tool failed" }],
      isError: true,
    });
  }
}

export async function GET() {
  return Response.json({ name: "volta-operations", status: "ok", transport: "stateless-http" });
}
