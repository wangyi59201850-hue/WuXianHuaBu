export type BatchDownloadAsset = {
  url: string;
  fileName?: string | null;
  suggestedName?: string | null;
  mediaType?: "image" | "video" | "file";
};

export type BatchDownloadOutcome = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  downloadDir?: string;
  savedCount?: number;
  failedCount?: number;
};

function inferExtension(value: string, mediaType: BatchDownloadAsset["mediaType"]) {
  const text = value.trim();
  if (text) {
    const fromName = text.match(/\.([a-z0-9]{2,6})(?:$|[?#])/i);
    if (fromName?.[1]) return `.${fromName[1].toLowerCase()}`;
  }
  return mediaType === "video" ? ".mp4" : mediaType === "image" ? ".png" : ".bin";
}

function fallbackBrowserDownload(items: BatchDownloadAsset[]): BatchDownloadOutcome {
  let savedCount = 0;
  for (const item of items) {
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url) continue;
    const candidateName =
      (typeof item.fileName === "string" && item.fileName.trim()) ||
      (typeof item.suggestedName === "string" && item.suggestedName.trim()) ||
      `media-${savedCount + 1}${inferExtension(url, item.mediaType)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = candidateName;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    savedCount += 1;
  }
  return { ok: savedCount > 0, savedCount, failedCount: Math.max(0, items.length - savedCount) };
}

export async function batchDownloadAssets(items: BatchDownloadAsset[]): Promise<BatchDownloadOutcome> {
  const clean = items.filter((item) => typeof item.url === "string" && item.url.trim().length > 0);
  if (clean.length === 0) {
    return { ok: false, error: "没有可下载的素材。" };
  }

  if (window.desktopWindow?.isDesktop && typeof window.desktopWindow.batchDownloadAssets === "function") {
    return window.desktopWindow.batchDownloadAssets(clean);
  }

  return fallbackBrowserDownload(clean);
}
