export async function captureVideoPosterDataUrl(
  src: string,
  options?: { width?: number; quality?: number; timeoutMs?: number }
): Promise<string | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const clean = typeof src === "string" ? src.trim() : "";
  if (!clean) return null;

  const width = options?.width && options.width > 0 ? options.width : 640;
  const quality = options?.quality && options.quality > 0 ? options.quality : 0.82;
  const timeoutMs = options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 8000;

  return await new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.pause();
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };

    const tryDraw = () => {
      if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight)) {
        finish(null);
        return;
      }
      const targetW = Math.max(1, Math.round(width));
      const targetH = Math.max(1, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * targetW));
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish(null);
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, targetW, targetH);
        finish(canvas.toDataURL("image/jpeg", quality));
      } catch {
        finish(null);
      }
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    video.addEventListener(
      "loadeddata",
      () => {
        if (video.readyState >= 2) {
          tryDraw();
        }
      },
      { once: true }
    );
    video.addEventListener(
      "seeked",
      () => {
        tryDraw();
      },
      { once: true }
    );
    video.addEventListener(
      "loadedmetadata",
      () => {
        const snapTime =
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(0.08, Math.max(0, video.duration / 10))
            : 0;
        try {
          video.currentTime = snapTime;
        } catch {
          tryDraw();
        }
      },
      { once: true }
    );
    video.addEventListener(
      "error",
      () => {
        finish(null);
      },
      { once: true }
    );

    video.src = clean;
    video.load();
  });
}
