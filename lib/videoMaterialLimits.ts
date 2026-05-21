/** 与 `dreamina multimodal2video --help` 及即梦网页多参考规则对齐 */

export const MULTIMODAL_MAX_REF_VIDEOS = 3;
export const MULTIMODAL_MAX_REF_IMAGES = 9;
/** 三条参考视频时长之和（网页侧常见限制） */
export const MULTIMODAL_MAX_REF_VIDEO_TOTAL_SEC = 15;

export function multimodalRefCountErrorMessage(
  imageCount: number,
  videoCount: number
): string | null {
  if (videoCount > MULTIMODAL_MAX_REF_VIDEOS) {
    return `参考视频最多 ${MULTIMODAL_MAX_REF_VIDEOS} 条（即梦 multimodal 限制），当前 ${videoCount} 条。请减少连线或去掉部分视频素材。`;
  }
  if (imageCount > MULTIMODAL_MAX_REF_IMAGES) {
    return `参考图片最多 ${MULTIMODAL_MAX_REF_IMAGES} 张（即梦 multimodal 限制），当前 ${imageCount} 张。请减少连线或去掉部分图片素材。`;
  }
  return null;
}

export function multimodalRefVideoDurationErrorMessage(totalSec: number): string | null {
  if (totalSec > MULTIMODAL_MAX_REF_VIDEO_TOTAL_SEC + 0.05) {
    return `参考视频总时长超过 15 秒（当前合计约 ${totalSec.toFixed(1)} 秒），已取消上传。请换用更短素材或删减条数后重试。`;
  }
  return null;
}

/** 浏览器内读取本地视频时长（秒），失败返回 null */
export function probeVideoFileDurationSec(file: File): Promise<number | null> {
  if (!file.type.startsWith("video/")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (sec: number | null) => {
      clearTimeout(t);
      URL.revokeObjectURL(url);
      resolve(sec);
    };
    const t = setTimeout(() => done(null), 12_000);
    v.onloadedmetadata = () => {
      const d = v.duration;
      done(Number.isFinite(d) && d > 0 ? d : null);
    };
    v.onerror = () => done(null);
    v.src = url;
  });
}

export async function sumReferenceVideoDurationsSec(files: File[]): Promise<{
  total: number;
  unknownCount: number;
}> {
  let total = 0;
  let unknownCount = 0;
  for (const f of files) {
    const d = await probeVideoFileDurationSec(f);
    if (d == null) unknownCount += 1;
    else total += d;
  }
  return { total, unknownCount };
}
