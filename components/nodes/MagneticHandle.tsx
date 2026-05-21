"use client";

import type { CSSProperties, HTMLAttributes } from "react";
import { Handle, Position, type HandleProps } from "reactflow";
import { Plus } from "lucide-react";
import { MAGNETIC_HANDLE_EDGE_OUTSET } from "@/lib/promptPreviewShell";

type DivAttrs = Omit<HTMLAttributes<HTMLDivElement>, "id">;
type MagneticHandleBase = Omit<HandleProps, "type" | "position" | "children"> & DivAttrs;

/** 保持足够大的可拖拽热区，同时由位置参数控制连线贴边 */
const shell =
  "jimeng-mh-shell group/mh !relative !flex !h-[8px] !w-[8px] !items-center !justify-center !overflow-visible !rounded-full !border-0 !bg-transparent !shadow-none " +
  "before:absolute before:left-1/2 before:top-1/2 before:h-[64px] before:w-[64px] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:content-[''] " +
  "z-[5] !will-change-transform " +
  "!transition-[opacity,transform] !duration-200 !ease-out " +
  "hover:!scale-[1.08] active:!scale-[0.94] " +
  "hover:!cursor-grab active:!cursor-grabbing";

const innerWrap =
  "pointer-events-none absolute left-1/2 top-1/2 flex h-[64px] w-[64px] items-center justify-center !will-change-transform " +
  "!transition-transform !duration-300 !ease-[cubic-bezier(0.34,1.45,0.64,1)] group-hover/mh:!scale-[1.12]";

const VISUAL_HANDLE_OUTSET = 14;

const knobClass =
  "jimeng-mh-knob flex h-8 w-8 items-center justify-center rounded-full border-2 border-white/40 bg-transparent text-white/65 shadow-none " +
  "!transition-[box-shadow,border-color,color] !duration-300 !ease-out " +
  "group-hover/mh:border-zinc-200/80 group-hover/mh:text-zinc-100 group-hover/mh:shadow-[0_0_0_2px_rgba(212,212,216,0.18)]";

type MagneticExtra = {
  pinX?: number;
  pinY?: number;
  horizontalEdgeOutset?: number;
  magneticVisible?: boolean;
  visualOffsetX?: number;
  visualOffsetY?: number;
};

function HandleKnob() {
  return (
    <div className={knobClass}>
      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
    </div>
  );
}

function visibilityStyle(visible: boolean | undefined): CSSProperties {
  if (visible === undefined) return {};
  return visible
    ? { opacity: 1, pointerEvents: "auto" as const, transition: "opacity 0.2s ease" }
    : { opacity: 0, pointerEvents: "none" as const, transition: "opacity 0.15s ease" };
}

/** 大号连线区：两侧均为 +，悬停弹性放大 */
export function MagneticHandleTarget(props: MagneticHandleBase & MagneticExtra) {
  const {
    pinX,
    pinY,
    horizontalEdgeOutset,
    magneticVisible,
    visualOffsetX,
    visualOffsetY,
    className,
    style,
    ...rest
  } = props;
  const pinned = typeof pinX === "number";
  const o = horizontalEdgeOutset ?? MAGNETIC_HANDLE_EDGE_OUTSET;
  const knobOffsetX = visualOffsetX ?? (pinned ? 0 : -VISUAL_HANDLE_OUTSET);
  const knobOffsetY = visualOffsetY ?? 0;
  const mergedStyle = pinned
    ? {
        ...style,
        left: pinX,
        top: typeof pinY === "number" ? pinY : "50%",
        transform: "translate(-50%, -50%)" as const,
      }
    : {
        ...style,
        left: -o,
        top: typeof pinY === "number" ? pinY : "50%",
        transform: "translate(-50%, -50%)" as const,
      };
  return (
    <Handle
      {...rest}
      type="target"
      position={Position.Left}
      className={[
        shell,
        pinned ? "!absolute !right-auto !bottom-auto !translate-x-0" : "!absolute !right-auto !bottom-auto",
        className ?? "",
      ].join(" ")}
      style={{ ...mergedStyle, ...visibilityStyle(magneticVisible) }}
    >
      <div
        className={innerWrap}
        style={{
          transform: `translate(calc(-50% + ${knobOffsetX}px), calc(-50% + ${knobOffsetY}px))`,
        }}
      >
        <HandleKnob />
      </div>
    </Handle>
  );
}

export function MagneticHandleSource(props: MagneticHandleBase & MagneticExtra) {
  const {
    pinX,
    pinY,
    horizontalEdgeOutset,
    magneticVisible,
    visualOffsetX,
    visualOffsetY,
    className,
    style,
    ...rest
  } = props;
  const pinned = typeof pinX === "number";
  const o = horizontalEdgeOutset ?? MAGNETIC_HANDLE_EDGE_OUTSET;
  const knobOffsetX = visualOffsetX ?? (pinned ? 0 : VISUAL_HANDLE_OUTSET);
  const knobOffsetY = visualOffsetY ?? 0;
  const mergedStyle = pinned
    ? {
        ...style,
        left: pinX,
        top: typeof pinY === "number" ? pinY : "50%",
        transform: "translate(-50%, -50%)" as const,
      }
    : {
        ...style,
        right: -o,
        top: typeof pinY === "number" ? pinY : "50%",
        transform: "translate(50%, -50%)" as const,
      };
  return (
    <Handle
      {...rest}
      type="source"
      position={Position.Right}
      className={[
        shell,
        pinned ? "!absolute !right-auto !bottom-auto !translate-x-0" : "!absolute !left-auto !bottom-auto",
        className ?? "",
      ].join(" ")}
      style={{ ...mergedStyle, ...visibilityStyle(magneticVisible) }}
    >
      <div
        className={innerWrap}
        style={{
          transform: `translate(calc(-50% + ${knobOffsetX}px), calc(-50% + ${knobOffsetY}px))`,
        }}
      >
        <HandleKnob />
      </div>
    </Handle>
  );
}
