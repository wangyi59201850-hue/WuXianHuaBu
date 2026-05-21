"use client";

import { useEffect, useMemo, useState } from "react";

const BRIDGE_ORIGIN = "http://127.0.0.1:3210";
const STORAGE_KEY = "wuxianhuabu-local-bridge-enabled-v1";
const ALWAYS_BRIDGE_PATHS = new Set([
  "/api/cli_bootstrap",
  "/api/cli_meta",
  "/api/credit",
  "/api/login",
  "/api/logout",
  "/api/browsers",
  "/api/credential_health",
  "/api/tasks",
  "/api/query_task",
  "/api/generated/latest",
  "/api/generated/sync",
]);

declare global {
  interface Window {
    __wuxianhuabuLocalBridgePatched?: boolean;
    __wuxianhuabuOriginalFetch?: typeof window.fetch;
    __wuxianhuabuLocalBridgeEnabled?: boolean;
  }
}

function shouldUseBridgeForGenerate(body: BodyInit | null | undefined) {
  if (!body) return true;
  if (body instanceof FormData) {
    const mode = (body.get("mode") || "").toString().trim().toLowerCase();
    if (mode === "video") {
      const videoProvider = (body.get("videoProvider") || "dreamina")
        .toString()
        .trim()
        .toLowerCase();
      return videoProvider !== "external_api";
    }
    const provider = (body.get("provider") || "dreamina")
      .toString()
      .trim()
      .toLowerCase();
    return provider !== "aiwanwu";
  }
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as {
        provider?: string;
        mode?: string;
        videoProvider?: string;
      };
      if (String(parsed.mode || "").trim().toLowerCase() === "video") {
        return String(parsed.videoProvider || "dreamina").trim().toLowerCase() !== "external_api";
      }
      return String(parsed.provider || "dreamina").trim().toLowerCase() !== "aiwanwu";
    } catch {
      return true;
    }
  }
  return true;
}

function shouldRouteToBridge(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const requestUrl =
    input instanceof Request
      ? new URL(input.url, window.location.origin)
      : new URL(typeof input === "string" ? input : input.toString(), window.location.origin);
  if (requestUrl.origin !== window.location.origin) return false;
  if (ALWAYS_BRIDGE_PATHS.has(requestUrl.pathname)) return true;
  if (requestUrl.pathname === "/api/generate") {
    return shouldUseBridgeForGenerate(init?.body ?? (input instanceof Request ? null : null));
  }
  return false;
}

function patchFetchBridge() {
  if (typeof window === "undefined") return;
  if (window.__wuxianhuabuLocalBridgePatched) return;
  const originalFetch = window.fetch.bind(window);
  window.__wuxianhuabuOriginalFetch = originalFetch;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!window.__wuxianhuabuLocalBridgeEnabled) {
      return originalFetch(input as RequestInfo, init);
    }
    if (!shouldRouteToBridge(input, init)) {
      return originalFetch(input as RequestInfo, init);
    }
    if (input instanceof Request) {
      const merged = new Request(input, init);
      const bridged = new Request(
        `${BRIDGE_ORIGIN}${new URL(input.url, window.location.origin).pathname}${new URL(input.url, window.location.origin).search}`,
        merged
      );
      return originalFetch(bridged);
    }
    const raw = typeof input === "string" ? input : input.toString();
    const url = new URL(raw, window.location.origin);
    return originalFetch(`${BRIDGE_ORIGIN}${url.pathname}${url.search}`, init);
  }) as typeof window.fetch;
  window.__wuxianhuabuLocalBridgePatched = true;
}

export function LocalBridgeClient() {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    patchFetchBridge();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const nextEnabled = raw === "1";
      setEnabled(nextEnabled);
      window.__wuxianhuabuLocalBridgeEnabled = nextEnabled;
    } catch {
      window.__wuxianhuabuLocalBridgeEnabled = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`${BRIDGE_ORIGIN}/health`, { cache: "no-store" });
        if (!response.ok) throw new Error("bridge unavailable");
        if (!cancelled) {
          setAvailable(true);
          setCheckedAt(Date.now());
        }
      } catch {
        if (!cancelled) {
          setAvailable(false);
          setCheckedAt(Date.now());
        }
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), enabled ? 6000 : 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled]);

  const statusLabel = useMemo(() => {
    if (available && enabled) return "本机 CLI 模式已启用";
    if (available) return "检测到本机桥接器";
    return "未检测到本机桥接器";
  }, [available, enabled]);

  const hint = useMemo(() => {
    if (available && enabled) return "网站会把 Dreamina CLI 相关请求转到你的本机。";
    if (available) return "点击启用后，登录、任务和 Dreamina 生成会走本机桥接器。";
    return "先在用户电脑运行 npm run bridge:start，网站才能接本机 CLI。";
  }, [available, enabled]);

  const toggle = () => {
    const next = available && !enabled;
    setEnabled(next);
    window.__wuxianhuabuLocalBridgeEnabled = next;
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80]">
      <div className="pointer-events-auto w-[min(88vw,360px)] rounded-xl border border-white/10 bg-zinc-950/88 p-3 text-white shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{statusLabel}</div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">{hint}</p>
            {checkedAt ? (
              <p className="mt-1 text-[11px] text-zinc-500">
                最近检测 {new Date(checkedAt).toLocaleTimeString("zh-CN")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-medium",
              available
                ? enabled
                  ? "bg-emerald-500 text-white hover:bg-emerald-400"
                  : "bg-sky-500 text-white hover:bg-sky-400"
                : "cursor-not-allowed bg-zinc-800 text-zinc-400",
            ].join(" ")}
            onClick={toggle}
            disabled={!available}
          >
            {enabled ? "停用本机 CLI" : "启用本机 CLI"}
          </button>
        </div>
      </div>
    </div>
  );
}
