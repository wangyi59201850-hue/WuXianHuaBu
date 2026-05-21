import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LOG_BASENAME = "jimengpro-media-debug.log";

function logPath() {
  return path.join(os.tmpdir(), LOG_BASENAME);
}

/** 打包后排查用：写入 %TEMP%/jimengpro-media-debug.log */
export function logMediaDebug(message: string, meta?: Record<string, unknown>) {
  const line =
    meta && Object.keys(meta).length > 0
      ? `${message} ${JSON.stringify(meta)}`
      : message;
  try {
    fs.appendFileSync(
      logPath(),
      `[${new Date().toISOString()}] ${line}${os.EOL}`,
      "utf8"
    );
  } catch {
    /* ignore */
  }
}

export function getMediaDebugLogPath() {
  return logPath();
}
