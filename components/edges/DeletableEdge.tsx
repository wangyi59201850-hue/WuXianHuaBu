"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "reactflow";
import { Unlink2 } from "lucide-react";

function DeletableEdgeInner(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
    selected,
  } = props;
  const { setEdges } = useReactFlow();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.28,
  });

  const glowStroke = selected ? "rgba(212, 212, 216, 0.14)" : "rgba(161, 161, 170, 0.08)";
  const dimStroke = selected ? "rgba(228, 228, 231, 0.82)" : "rgba(160, 170, 185, 0.62)";

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: glowStroke,
          strokeWidth: selected ? 4.6 : 3.4,
          ...style,
        }}
      />
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={22}
        style={{
          stroke: dimStroke,
          strokeWidth: selected ? 1.9 : 1.55,
          ...style,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nopan nodrag"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            zIndex: 1001,
            pointerEvents: "all",
          }}
        >
          <button
            type="button"
            title="删除连线（或双击连线）"
            className={[
              "flex size-6 items-center justify-center rounded-full border border-zinc-700/35 bg-zinc-900/62 text-zinc-400 shadow-sm backdrop-blur-sm transition-all duration-200",
              "hover:border-red-500/30 hover:bg-red-950/42 hover:text-red-200",
              selected ? "scale-100 opacity-90" : "opacity-28 hover:scale-[1.03] hover:opacity-78",
            ].join(" ")}
            onClick={(e) => {
              e.stopPropagation();
              setEdges((es) => es.filter((edge) => edge.id !== id));
            }}
          >
            <Unlink2 className="h-3 w-3" strokeWidth={1.8} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const DeletableEdge = memo(DeletableEdgeInner);
