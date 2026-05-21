import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { type NodeProps } from "reactflow";
import { Ungroup } from "lucide-react";
import {
  CANVAS_NODE_DRAG_ARM_MS_INSIDE,
  CANVAS_NODE_DRAG_ARM_MS_OUTSIDE,
  CANVAS_NODE_DRAG_ARM_MOVE_TOLERANCE_PX,
} from "@/lib/canvasNodeLongPressDrag";

export type GroupNodeData = {
  frameColor?: string;
  onUngroup?: () => void;
  onFrameColorChange?: (hex: string) => void;
  groupCanvasDragArmed?: boolean;
  onArmGroupCanvasDrag?: () => void;
};

const CTRL_SIZE = 64;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function GroupNode({ data, selected }: NodeProps<GroupNodeData>) {
  const pointerInsideRef = useRef(false);
  const armTimerRef = useRef<number | null>(null);
  const armStartRef = useRef<{ x: number; y: number } | null>(null);
  const armWindowCleanupRef = useRef<null | (() => void)>(null);

  const clearArmTimer = useCallback(() => {
    if (armTimerRef.current != null) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    armStartRef.current = null;
    const cleanup = armWindowCleanupRef.current;
    armWindowCleanupRef.current = null;
    cleanup?.();
  }, []);

  useEffect(() => () => clearArmTimer(), [clearArmTimer]);

  const color = typeof data.frameColor === "string" && data.frameColor ? data.frameColor : "#52525b";
  const fill = useMemo(() => {
    const rgb = hexToRgb(color);
    if (!rgb) return "rgba(82, 82, 91, 0.03)";
    return `rgba(${rgb.r},${rgb.g},${rgb.b},0.032)`;
  }, [color]);
  const stroke = useMemo(() => {
    const rgb = hexToRgb(color);
    if (!rgb) return "rgba(82, 82, 91, 0.28)";
    return `rgba(${rgb.r},${rgb.g},${rgb.b},0.26)`;
  }, [color]);

  const dragHint =
    Boolean(data.onArmGroupCanvasDrag) && !data.groupCanvasDragArmed;

  return (
    <div
      className={[
        "relative h-full w-full rounded-lg",
        dragHint ? "cursor-default" : "",
        data.groupCanvasDragArmed ? "cursor-grab active:cursor-grabbing" : "",
        selected ? "ring-2 ring-white/25 ring-offset-2 ring-offset-black/80" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        backgroundColor: fill,
        boxShadow: `inset 0 0 0 2px ${stroke}`,
      }}
      onPointerEnter={() => {
        pointerInsideRef.current = true;
      }}
      onPointerLeave={(e) => {
        if (e.buttons === 0) {
          pointerInsideRef.current = false;
          clearArmTimer();
        }
      }}
      onPointerDown={(e) => {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("button, input, label")) return;
        if (!data.onArmGroupCanvasDrag || data.groupCanvasDragArmed) return;
        clearArmTimer();
        armStartRef.current = { x: e.clientX, y: e.clientY };
        const tol = CANVAS_NODE_DRAG_ARM_MOVE_TOLERANCE_PX;
        const tol2 = tol * tol;
        const onMove = (ev: PointerEvent) => {
          const s = armStartRef.current;
          if (s == null) return;
          const dx = ev.clientX - s.x;
          const dy = ev.clientY - s.y;
          if (dx * dx + dy * dy > tol2) clearArmTimer();
        };
        const onEnd = () => clearArmTimer();
        armWindowCleanupRef.current = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onEnd);
          window.removeEventListener("pointercancel", onEnd);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onEnd);
        window.addEventListener("pointercancel", onEnd);
        const delayMs = pointerInsideRef.current
          ? CANVAS_NODE_DRAG_ARM_MS_INSIDE
          : CANVAS_NODE_DRAG_ARM_MS_OUTSIDE;
        armTimerRef.current = window.setTimeout(() => {
          armWindowCleanupRef.current?.();
          armWindowCleanupRef.current = null;
          armTimerRef.current = null;
          armStartRef.current = null;
          data.onArmGroupCanvasDrag?.();
        }, delayMs);
      }}
      onPointerUp={clearArmTimer}
      onPointerCancel={clearArmTimer}
    >
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        <label
          className="relative flex cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/15 shadow-sm backdrop-blur-[2px]"
          style={{ width: CTRL_SIZE, height: CTRL_SIZE }}
          title="区域颜色"
        >
          <span
            className="pointer-events-none rounded-full ring-1 ring-black/25"
            style={{
              width: 40,
              height: 40,
              backgroundColor: color,
            }}
          />
          <input
            type="color"
            value={color}
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => data.onFrameColorChange?.(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </label>
        <button
          type="button"
          title="解组"
          className="flex items-center justify-center rounded-xl border border-white/20 bg-black/18 text-zinc-100 shadow-sm backdrop-blur-md transition-colors hover:bg-white/12"
          style={{ width: CTRL_SIZE, height: CTRL_SIZE }}
          onClick={(e) => {
            e.stopPropagation();
            data.onUngroup?.();
          }}
        >
          <Ungroup className="h-9 w-9" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
