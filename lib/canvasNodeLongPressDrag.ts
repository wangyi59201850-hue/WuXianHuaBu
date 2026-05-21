/**
 * React Flow `Node.dragHandle`：仅从带此 class 的区域发起拖拽。
 * 解决「长按才把 draggable 设为 true」与 RF 在 mousedown 时读取 draggable 不同步 → 第一次拖不动、第二次才行。
 */
export const JIMENG_RF_DRAG_HANDLE_SELECTOR = ".jimeng-canvas-node-drag-handle";

/**
 * 指针已在节点框内时的武装延迟（分组节点等仍用长按解锁拖拽）。
 * 不可为 0：`setTimeout(0)` 常在 `pointerup`/`click` 之前执行，会误触发武装并吞掉「单击打开面板」等逻辑。
 */
export const CANVAS_NODE_DRAG_ARM_MS_INSIDE = 200;

/**
 * 未先进入节点框就按下时的后备延迟（极少见）。
 */
export const CANVAS_NODE_DRAG_ARM_MS_OUTSIDE = 96;

/** @deprecated 使用 INSIDE / OUTSIDE */
export const CANVAS_NODE_DRAG_ARM_MS = CANVAS_NODE_DRAG_ARM_MS_INSIDE;

/**
 * 按下后允许的指针位移（px，欧氏距离）；超过则取消本次长按，
 * 略放大便于「按住稍晃仍能触发」。
 */
export const CANVAS_NODE_DRAG_ARM_MOVE_TOLERANCE_PX = 26;
