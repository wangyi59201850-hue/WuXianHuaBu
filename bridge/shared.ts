import { Readable } from "node:stream";

export const LOCAL_BRIDGE_PORT = Number(process.env.LOCAL_BRIDGE_PORT || "3210") || 3210;
export const LOCAL_BRIDGE_ORIGIN = `http://127.0.0.1:${LOCAL_BRIDGE_PORT}`;

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.wybottle.com",
  "https://wybottle.com",
  "http://127.0.0.1:3005",
  "http://127.0.0.1:3006",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];

function configuredAllowedOrigins() {
  const raw = process.env.LOCAL_BRIDGE_ALLOWED_ORIGINS?.trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveRequestOrigin(originHeader: string | null) {
  const allowed = configuredAllowedOrigins();
  if (!originHeader) return allowed[0] ?? LOCAL_BRIDGE_ORIGIN;
  if (allowed.includes(originHeader)) return originHeader;
  try {
    const parsed = new URL(originHeader);
    if (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "wybottle.com" ||
      parsed.hostname === "www.wybottle.com"
    ) {
      return originHeader;
    }
  } catch {
    // ignore
  }
  return null;
}

export function withCorsHeaders(response: Response, requestOrigin: string | null) {
  const headers = new Headers(response.headers);
  const allowedOrigin = resolveRequestOrigin(requestOrigin);
  if (allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Credentials", "false");
  }
  headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Jimeng-Stream, X-Requested-With"
  );
  headers.set("Access-Control-Allow-Private-Network", "true");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function preflightResponse(requestOrigin: string | null) {
  return withCorsHeaders(new Response(null, { status: 204 }), requestOrigin);
}

export async function nodeRequestToRequest(
  req: import("node:http").IncomingMessage,
  fullUrl: string
) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request(fullUrl, {
    method: req.method || "GET",
    headers: req.headers as HeadersInit,
    body:
      body && req.method && !["GET", "HEAD"].includes(req.method.toUpperCase())
        ? body
        : undefined,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

export async function sendNodeResponse(
  res: import("node:http").ServerResponse,
  response: Response,
  requestOrigin: string | null
) {
  const corsResponse = withCorsHeaders(response, requestOrigin);
  res.statusCode = corsResponse.status;
  corsResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!corsResponse.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(corsResponse.body as any);
  stream.pipe(res);
}

export function absolutizeGeneratedUrl(value: string, bridgeOrigin = LOCAL_BRIDGE_ORIGIN) {
  const text = value.trim();
  if (!text) return text;
  if (text.startsWith("/api/generated/file?") || text.startsWith("/outputs/generated/")) {
    return `${bridgeOrigin}${text}`;
  }
  return text;
}

export function rewriteBridgePayload<T>(input: T, bridgeOrigin = LOCAL_BRIDGE_ORIGIN): T {
  if (typeof input === "string") {
    return absolutizeGeneratedUrl(input, bridgeOrigin) as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => rewriteBridgePayload(item, bridgeOrigin)) as T;
  }
  if (!input || typeof input !== "object") return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = rewriteBridgePayload(value, bridgeOrigin);
  }
  return out as T;
}

export async function rewriteBridgeResponse(
  response: Response,
  bridgeOrigin = LOCAL_BRIDGE_ORIGIN
) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/x-ndjson")) {
    const text = await response.text();
    const lines = text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          const parsed = JSON.parse(line) as unknown;
          return JSON.stringify(rewriteBridgePayload(parsed, bridgeOrigin));
        } catch {
          return line;
        }
      });
    return new Response(lines.join("\n") + (lines.length > 0 ? "\n" : ""), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  if (contentType.includes("application/json")) {
    const json = (await response.json().catch(() => null)) as unknown;
    return Response.json(rewriteBridgePayload(json, bridgeOrigin), {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}

export function readJsonBuffer<T>(input: Buffer | string | null | undefined) {
  if (!input) return null;
  try {
    return JSON.parse(Buffer.isBuffer(input) ? input.toString("utf8") : input) as T;
  } catch {
    return null;
  }
}
