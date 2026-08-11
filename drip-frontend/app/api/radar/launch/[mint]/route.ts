import { NextResponse } from "next/server";

const RADAR_API = process.env.RADAR_API_URL ?? "http://localhost:3950";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ mint: string }> },
) {
  const { mint } = await ctx.params;
  if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  }

  try {
    const res = await fetch(`${RADAR_API}/api/launch/${mint}`, { cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Radar service unavailable" }, { status: 503 });
  }
}
