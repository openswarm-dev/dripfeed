/** Resolve radar backend URL (supports Render private host:port without scheme). */
export function getRadarApiUrl(): string {
  const raw = process.env.RADAR_API_URL?.trim() || "http://localhost:3950";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `http://${raw}`;
}
