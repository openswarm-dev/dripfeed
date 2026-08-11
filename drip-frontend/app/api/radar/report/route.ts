import { NextResponse } from "next/server";

const RADAR_API = process.env.RADAR_API_URL ?? "http://localhost:3950";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${RADAR_API}/api/report`, { cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      { error: "Radar service unavailable. Deploy betttr-radar on Railway." },
      { status: 503 },
    );
  }
}
