import React from "react";
import { TriangleAlert } from "lucide-react";

type Props = {
  open: boolean;
  mediaLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onOverwrite: () => void;
  onBackupAndGenerate: () => void;
};

export function RegenerateConfirmModal({
  open,
  mediaLabel,
  busy = false,
  onCancel,
  onOverwrite,
  onBackupAndGenerate,
}: Props) {
  if (!open) return null;

  return (
    <div className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/85 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-white shadow-xl">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <div className="text-sm font-medium">当前已有生成结果</div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              再次生成将替换本节点正在展示的{mediaLabel}。可选择覆盖生成，或先将当前结果备份到输出目录{" "}
              <code className="rounded bg-zinc-800 px-1 text-[11px] text-zinc-200">
                public/outputs/generated/.backup/
              </code>{" "}
              下（按节点 ID 分子文件夹）再生成；仅可复制本站已生成的成片路径，不会影响其他节点。
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={busy}
            className="h-9 rounded-lg border border-zinc-600 bg-zinc-800 px-3 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            className="h-9 rounded-lg border border-rose-700/80 bg-rose-950/50 px-3 text-sm text-rose-100 hover:bg-rose-900/60 disabled:opacity-50"
            onClick={onOverwrite}
          >
            覆盖生成
          </button>
          <button
            type="button"
            disabled={busy}
            className="h-9 rounded-lg border border-white/12 bg-white/[0.06] px-3 text-sm text-zinc-100 hover:bg-white/10 disabled:opacity-50"
            onClick={onBackupAndGenerate}
          >
            {busy ? "正在备份…" : "备份后生成"}
          </button>
        </div>
      </div>
    </div>
  );
}
