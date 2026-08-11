import { NextResponse } from "next/server";

const RADAR_API = process.env.RADAR_API_URL ?? "http://localhost:3950";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const upstream = await fetch(`${RADAR_API}/api/stream`, {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Stream unavailable" }, { status: 503 });
    }

    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return NextResponse.json({ error: "Radar stream unavailable" }, { status: 503 });
  }
}
