/** 点击画布空白或其它节点时关闭素材/结果「放大预览」层 */
export const JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT = "jimeng-close-media-lightbox";

export function dispatchCloseMediaLightbox() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT));
}
