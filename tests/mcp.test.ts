import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/mcp/route";

describe("MCP HTTP contract", () => {
  beforeEach(() => {
    globalThis.__voltaSnapshot = undefined;
    delete process.env.VOLTA_MCP_SECRET;
  });

  it("negotiates protocol and exposes only the six narrow tools", async () => {
    const initialize = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18" },
        }),
      }),
    );
    expect(initialize.status).toBe(200);
    expect((await initialize.json()).result.protocolVersion).toBe("2025-06-18");

    const list = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      }),
    );
    const body = await list.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "get_operation_context",
      "record_offer",
      "stage_booking",
      "confirm_booking",
      "report_operational_change",
      "request_handoff",
    ]);
  });

  it("returns human mandate context without carrier phone numbers", async () => {
    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "get_operation_context",
            arguments: { operationId: "op-2041", callId: "test-call" },
          },
        }),
      }),
    );
    const body = await response.json();
    expect(body.result.isError).toBe(false);
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("+5255");
    expect(body.result.structuredContent.mandate.maximumRate).toBe(9000);
  });
});

