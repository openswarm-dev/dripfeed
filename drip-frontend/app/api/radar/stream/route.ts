import { NextResponse } from "next/server";
import { getRadarApiUrl } from "@/lib/radarApiUrl";

const RADAR_API = getRadarApiUrl();

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
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Radar stream unavailable — ensure narra backend is running on RADAR_API_URL" },
      { status: 503 },
    );
  }
}
