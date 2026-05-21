/**
 * 浏览器内将参考图压成 JPEG data URL，供历史记录存盘（仅客户端调用）。
 */
export async function filesToJpegDataUrls(
  files: File[],
  opts?: { max?: number; maxSide?: number; quality?: number }
): Promise<string[]> {
  if (typeof document === "undefined") return [];
  const max = opts?.max ?? 3;
  const maxSide = opts?.maxSide ?? 120;
  const quality = opts?.quality ?? 0.68;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const out: string[] = [];
  for (let i = 0; i < files.length && out.length < max; i++) {
    const f = files[i];
    if (!f.type.startsWith("image/")) continue;
    try {
      const bmp = await createImageBitmap(f);
      const w = bmp.width;
      const h = bmp.height;
      const scale = Math.min(1, maxSide / Math.max(w, h, 1));
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      out.push(canvas.toDataURL("image/jpeg", quality));
      bmp.close();
    } catch {
      /* skip broken decode */
    }
  }
  return out;
}
