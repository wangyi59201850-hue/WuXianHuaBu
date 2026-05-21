"use client";

import { useEffect, useMemo, useState } from "react";

const LOCAL_BRIDGE_MEDIA_RE = /^http:\/\/(?:127\.0\.0\.1|localhost):3210\/(?:api\/generated\/file|outputs\/generated\/)/i;

const resolvedBridgeMediaCache = new Map<string, string>();
const pendingBridgeMediaCache = new Map<string, Promise<string>>();

export function isLocalBridgeMediaUrl(url: string | null | undefined) {
  const text = typeof url === "string" ? url.trim() : "";
  return Boolean(text) && LOCAL_BRIDGE_MEDIA_RE.test(text);
}

async function fetchBridgeMediaAsObjectUrl(url: string) {
  const cached = resolvedBridgeMediaCache.get(url);
  if (cached) return cached;
  const pending = pendingBridgeMediaCache.get(url);
  if (pending) return await pending;

  const next = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch bridge media: ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      resolvedBridgeMediaCache.set(url, objectUrl);
      pendingBridgeMediaCache.delete(url);
      return objectUrl;
    })
    .catch((error) => {
      pendingBridgeMediaCache.delete(url);
      throw error;
    });

  pendingBridgeMediaCache.set(url, next);
  return await next;
}

export function useLocalBridgeMediaUrl(rawUrl: string | null | undefined) {
  const normalized = useMemo(
    () => (typeof rawUrl === "string" && rawUrl.trim() ? rawUrl.trim() : null),
    [rawUrl]
  );
  const [displayUrl, setDisplayUrl] = useState<string | null>(normalized);

  useEffect(() => {
    if (!normalized) {
      setDisplayUrl(null);
      return;
    }
    if (!isLocalBridgeMediaUrl(normalized)) {
      setDisplayUrl(normalized);
      return;
    }
    const cached = resolvedBridgeMediaCache.get(normalized);
    if (cached) {
      setDisplayUrl(cached);
      return;
    }
    let cancelled = false;
    setDisplayUrl(normalized);
    void fetchBridgeMediaAsObjectUrl(normalized)
      .then((objectUrl) => {
        if (!cancelled) setDisplayUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setDisplayUrl(normalized);
      });
    return () => {
      cancelled = true;
    };
  }, [normalized]);

  return displayUrl;
}
