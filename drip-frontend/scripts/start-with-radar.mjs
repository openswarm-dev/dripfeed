/**
 * Production start: run betttr-radar on an internal port, then Next.js on $PORT.
 * Skips bundled radar when RADAR_API_URL points to an external host.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const radarRoot = path.resolve(frontendRoot, "..", "betttr-radar");
const RADAR_PORT = process.env.RADAR_INTERNAL_PORT || "3950";
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

function isExternalRadarUrl(url) {
  if (!url) return false;
  return !url.includes("localhost") && !url.includes("127.0.0.1");
}

async function waitForRadar(maxMs = 90_000) {
  const url = `http://127.0.0.1:${RADAR_PORT}/health`;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log(`[betttr] Radar ready on :${RADAR_PORT}`);
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  console.warn("[betttr] Radar health check timed out — starting Next anyway");
}

function run(cmd, args, opts) {
  return spawn(cmd, args, { stdio: "inherit", shell: isWin, ...opts });
}

const useExternal = isExternalRadarUrl(process.env.RADAR_API_URL);

if (!useExternal) {
  if (!process.env.RADAR_API_URL) {
    process.env.RADAR_API_URL = `http://127.0.0.1:${RADAR_PORT}`;
  }

  console.log(`[betttr] Starting bundled radar → ${process.env.RADAR_API_URL}`);

  const radar = run(npm, ["start"], {
    cwd: radarRoot,
    env: {
      ...process.env,
      PORT: RADAR_PORT,
      BETTTR_RADAR_PORT: RADAR_PORT,
      NARRA_PORT: RADAR_PORT,
    },
  });

  radar.on("exit", (code) => {
    console.error(`[betttr] Radar exited (${code ?? 1})`);
    process.exit(code ?? 1);
  });

  await waitForRadar();
} else {
  console.log(`[betttr] Using external RADAR_API_URL: ${process.env.RADAR_API_URL}`);
}

const next = run(npm, ["run", "start:next"], {
  cwd: frontendRoot,
  env: process.env,
});

next.on("exit", (code) => process.exit(code ?? 0));
