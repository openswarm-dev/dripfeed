const RADAR_API = process.env.RADAR_API_URL ?? "http://localhost:3950";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let upstream: Response;
  try {
    upstream = await fetch(`${RADAR_API}/api/stream`, {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Radar stream unavailable" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ error: "Stream unavailable" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const upstreamBody = upstream.body;

  const stream = new ReadableStream({
    async start(controller) {
      // Heartbeat keeps Railway/CDN from closing idle SSE connections.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      const reader = upstreamBody.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // upstream closed
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Transfer-Encoding": "chunked",
    },
  });
}
