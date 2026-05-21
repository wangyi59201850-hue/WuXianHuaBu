/** 与 PromptNode 画布预览框一致：中间输出壳尺寸 + 左右磁吸柄占位 */
const HANDLE_GUTTER = 40;

/** 小锚点贴在卡片边缘，透明热区单独外扩用于拖拽 */
export const MAGNETIC_HANDLE_EDGE_OUTSET = 0;
/** 让扩图/预览区域给编辑与选区留出更多空间 */
export const PROMPT_PREVIEW_BAND_H = 256;
const PREVIEW_MAX_W = 360;

export function computePromptPreviewShellDimensions(ratio: string): {
  shellW: number;
  shellH: number;
  handleRowW: number;
  previewBandH: number;
  handleGutter: number;
} {
  const [w0, h0] = ratio.split(":").map((n) => Number(n));
  const ar =
    Number.isFinite(w0) && Number.isFinite(h0) && w0 > 0 && h0 > 0 ? w0 / h0 : 16 / 9;
  let shellW: number;
  let shellH: number;
  if (!Number.isFinite(ar) || ar <= 0) {
    shellW = PREVIEW_MAX_W;
    shellH = PROMPT_PREVIEW_BAND_H;
  } else {
    const boxAr = PREVIEW_MAX_W / PROMPT_PREVIEW_BAND_H;
    if (ar >= boxAr) {
      shellW = PREVIEW_MAX_W;
      shellH = PREVIEW_MAX_W / ar;
    } else {
      shellH = PROMPT_PREVIEW_BAND_H;
      shellW = PROMPT_PREVIEW_BAND_H * ar;
    }
  }
  return {
    shellW,
    shellH,
    handleRowW: shellW + HANDLE_GUTTER * 2,
    previewBandH: PROMPT_PREVIEW_BAND_H,
    handleGutter: HANDLE_GUTTER,
  };
}
