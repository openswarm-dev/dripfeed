import { NextResponse } from "next/server";
import { getRadarApiUrl } from "@/lib/radarApiUrl";

const RADAR_API = getRadarApiUrl();

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
      {
        error:
          "Radar service unavailable. Run npm run dev in DEVSNIPER/narra or set RADAR_API_URL to your Railway radar service.",
      },
      { status: 503 },
    );
  }
}
