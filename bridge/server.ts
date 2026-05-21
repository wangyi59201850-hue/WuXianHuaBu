import http from "node:http";
import { URL } from "node:url";

delete process.env.CLOUD_DEPLOYMENT;
delete process.env.NEXT_PUBLIC_DEPLOY_TARGET;

import {
  LOCAL_BRIDGE_ORIGIN,
  LOCAL_BRIDGE_PORT,
  nodeRequestToRequest,
  preflightResponse,
  sendNodeResponse,
} from "@/bridge/shared";
import {
  bridgeGeneratedFileHandler,
  bridgeGenerateHandler,
  browsersHandler,
  cliBootstrapHandler,
  cliMetaHandler,
  creditHandler,
  credentialHealthHandler,
  generatedLatestHandler,
  generatedSyncHandler,
  healthHandler,
  loginHandler,
  logoutHandler,
  queryTaskHandler,
  tasksHandler,
} from "@/bridge/localHandlers";

type RouteHandler = (req: Request) => Promise<Response> | Response;

const routes: Record<string, Partial<Record<"GET" | "POST" | "DELETE", RouteHandler>>> = {
  "/health": {
    GET: healthHandler,
  },
  "/api/cli_bootstrap": {
    POST: cliBootstrapHandler,
  },
  "/api/cli_meta": {
    GET: cliMetaHandler,
  },
  "/api/credit": {
    GET: creditHandler,
  },
  "/api/login": {
    POST: loginHandler,
  },
  "/api/logout": {
    POST: logoutHandler,
  },
  "/api/browsers": {
    GET: browsersHandler,
  },
  "/api/credential_health": {
    GET: credentialHealthHandler,
  },
  "/api/tasks": {
    GET: tasksHandler,
  },
  "/api/query_task": {
    GET: queryTaskHandler,
  },
  "/api/generated/latest": {
    GET: generatedLatestHandler,
  },
  "/api/generated/sync": {
    POST: generatedSyncHandler,
  },
  "/api/generated/file": {
    GET: bridgeGeneratedFileHandler,
  },
  "/api/generate": {
    POST: bridgeGenerateHandler,
  },
};

const server = http.createServer(async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  const requestUrl = new URL(req.url || "/", LOCAL_BRIDGE_ORIGIN);
  const route = routes[requestUrl.pathname];
  const originHeader = typeof req.headers.origin === "string" ? req.headers.origin : null;

  if (method === "OPTIONS") {
    await sendNodeResponse(res, preflightResponse(originHeader), originHeader);
    return;
  }

  const handler = route?.[method as "GET" | "POST" | "DELETE"];
  if (!handler) {
    await sendNodeResponse(
      res,
      Response.json({ ok: false, error: "not found" }, { status: 404 }),
      originHeader
    );
    return;
  }

  try {
    const request = await nodeRequestToRequest(req, requestUrl.toString());
    const response = await handler(request);
    await sendNodeResponse(res, response, originHeader);
  } catch (error) {
    await sendNodeResponse(
      res,
      Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      ),
      originHeader
    );
  }
});

server.listen(LOCAL_BRIDGE_PORT, "127.0.0.1", () => {
  console.log(`WuXianHuaBu local bridge listening on ${LOCAL_BRIDGE_ORIGIN}`);
});
