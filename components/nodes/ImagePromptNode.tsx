import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type NodeProps, useReactFlow } from "reactflow";
import {
  ChevronDown,
  Download,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Server,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  computeProgressFromStreamEvent,
  formatGenerateProgressLine,
  isProgressQueuePhase,
  type GenerateStreamProgressEvent,
} from "@/lib/generateStreamProgress";
import { type PromptNodeData } from "./PromptNode";
import {
  isLocalBridgeMediaUrl,
  useLocalBridgeMediaUrl,
} from "@/lib/localBridgeMedia";

type ModelRow = {
  value: string;
  title: string;
  time: string;
  desc: string;
};

const EXTERNAL_IMAGE_MODELS: ModelRow[] = [
  { value: "gpt-image-2-c", title: "gpt-image-2-c", time: "20s", desc: "GPT image model" },
];

const DREAMINA_MODELS: ModelRow[] = [
  { value: "5.0", title: "即梦5.0 Lite", time: "约1分钟", desc: "默认本地生图模型" },
  { value: "4.6", title: "Seedream 4.6", time: "约1分钟", desc: "高质量细节与光影" },
  { value: "4.5", title: "Seedream 4.5", time: "约1分钟", desc: "均衡速度与画质" },
];

const RATIO_OPTIONS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"];
const STORAGE_KEY_PREFIX = "image-prompt-node-state";

function downloadMediaUrls(urls: string[], filePrefix: string) {
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    if (!url) continue;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filePrefix}-${String(i + 1).padStart(2, "0")}.png`;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

export function ImagePromptNode({ id, data, selected }: NodeProps<PromptNodeData>) {
  const { setNodes } = useReactFlow();
  const storageKey = `${STORAGE_KEY_PREFIX}:${id}`;
  const activeGenerateTokenRef = useRef(0);

  const [imageProvider, setImageProvider] = useState<"dreamina" | "aiwanwu">(
    data.imageProvider ?? "dreamina"
  );
  const [externalImageModels, setExternalImageModels] = useState<string[]>([]);
  const [modelVersion, setModelVersion] = useState(data.modelVersion ?? "5.0");
  const [ratio, setRatio] = useState(data.ratio ?? "16:9");
  const [resolutionType, setResolutionType] = useState(data.resolutionType ?? "2k");
  const [count, setCount] = useState(typeof data.count === "number" ? data.count : 4);
  const [editorText, setEditorText] = useState(data.promptText ?? "");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [streamStatusLine, setStreamStatusLine] = useState<string | null>(null);
  const [streamInQueue, setStreamInQueue] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [resultImageUrls, setResultImageUrls] = useState<string[]>([]);
  const [lastUsage, setLastUsage] = useState<{
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  } | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [countMenuOpen, setCountMenuOpen] = useState(false);

  const rawCurrentDisplayUrl = resultImageUrls[0] ?? resultImageUrl ?? null;
  const bridgeCurrentDisplayUrl = useLocalBridgeMediaUrl(rawCurrentDisplayUrl);
  const currentDisplayUrl =
    bridgeCurrentDisplayUrl ||
    (isLocalBridgeMediaUrl(rawCurrentDisplayUrl) ? null : rawCurrentDisplayUrl);
  const currentModels = useMemo(
    () =>
      imageProvider === "aiwanwu"
        ? (externalImageModels.length > 0 ? externalImageModels : EXTERNAL_IMAGE_MODELS.map((m) => m.value)).map(
            (value) => ({
              value,
              title: value,
              time: "20s",
              desc: "GPT image model",
            })
          )
        : DREAMINA_MODELS,
    [imageProvider, externalImageModels]
  );

  useEffect(() => {
    setImageProvider(data.imageProvider ?? "dreamina");
  }, [data.imageProvider]);

  useEffect(() => {
    if (imageProvider !== "aiwanwu") return;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch("/api/aiwanwu/models?kind=image");
        const json = (await resp.json().catch(() => null)) as { models?: string[] } | null;
        if (cancelled) return;
        const models = Array.isArray(json?.models) ? json.models.filter(Boolean) : [];
        setExternalImageModels(models);
        if (models.length > 0 && !models.includes(modelVersion)) {
          setModelVersion(models[0]!);
        }
      } catch {
        if (!cancelled) setExternalImageModels(EXTERNAL_IMAGE_MODELS.map((m) => m.value));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageProvider, modelVersion]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        promptText: string;
        imageProvider: "dreamina" | "aiwanwu";
        modelVersion: string;
        ratio: string;
        resolutionType: string;
        count: number;
        resultImageUrl: string | null;
        resultImageUrls: string[];
        lastUsage: { total_tokens?: number; input_tokens?: number; output_tokens?: number } | null;
        loading: boolean;
        activeTaskId: string | null;
      }>;
      if (typeof parsed.promptText === "string") setEditorText(parsed.promptText);
      if (parsed.imageProvider === "dreamina" || parsed.imageProvider === "aiwanwu") {
        setImageProvider(parsed.imageProvider);
      }
      if (typeof parsed.modelVersion === "string") setModelVersion(parsed.modelVersion);
      if (typeof parsed.ratio === "string") setRatio(parsed.ratio);
      if (typeof parsed.resolutionType === "string") setResolutionType(parsed.resolutionType);
      if (typeof parsed.count === "number") setCount(parsed.count);
      if (typeof parsed.resultImageUrl === "string" || parsed.resultImageUrl === null) {
        setResultImageUrl(parsed.resultImageUrl ?? null);
      }
      if (Array.isArray(parsed.resultImageUrls)) setResultImageUrls(parsed.resultImageUrls);
      if (parsed.lastUsage && typeof parsed.lastUsage === "object") setLastUsage(parsed.lastUsage);
      if (parsed.loading) {
        setLoading(false);
        setLocalError("检测到上次生成中断，请重试。");
      }
      if (typeof parsed.activeTaskId === "string" || parsed.activeTaskId === null) {
        setActiveTaskId(parsed.activeTaskId ?? null);
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          promptText: editorText,
          imageProvider,
          modelVersion,
          ratio,
          resolutionType,
          count,
          resultImageUrl,
          resultImageUrls,
          lastUsage,
          loading,
          activeTaskId,
        })
      );
    } catch {
      /* ignore */
    }
  }, [storageKey, editorText, imageProvider, modelVersion, ratio, resolutionType, count, resultImageUrl, resultImageUrls, lastUsage, loading, activeTaskId]);

  useEffect(() => {
    if (Array.isArray(data.persistedPanelImageUrls) && data.persistedPanelImageUrls.length > 0) {
      setResultImageUrls(data.persistedPanelImageUrls);
      setResultImageUrl(null);
    } else if (typeof data.persistedPanelFirstImageUrl === "string" && data.persistedPanelFirstImageUrl.trim()) {
      setResultImageUrl(data.persistedPanelFirstImageUrl.trim());
      setResultImageUrls([]);
    }
  }, [data.persistedPanelImageUrls, data.persistedPanelFirstImageUrl, data.canvasGraphEpoch]);

  const persistPromptData = useCallback(
    (patch: Partial<PromptNodeData>) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...(node.data as PromptNodeData),
                  ...patch,
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  useEffect(() => {
    persistPromptData({
      imageProvider,
      modelVersion,
      ratio,
      resolutionType,
      count,
      promptText: editorText,
    });
  }, [imageProvider, modelVersion, ratio, resolutionType, count, editorText, activeTaskId, persistPromptData]);

  const beginGenerate = useCallback(async () => {
    if (!data.onGenerate) return;
    const prompt = editorText.trim();
    if (!prompt) {
      setLocalError("提示词不能为空");
      return;
    }
    const token = ++activeGenerateTokenRef.current;
    const taskId = `${id}-${Date.now()}-${token}`;
    setActiveTaskId(taskId);
    setLoading(true);
    setLocalError(null);
    setLastUsage(null);
    setResultImageUrl(null);
    setResultImageUrls([]);
    setProgress(0);
    setStreamStatusLine(null);
    setStreamInQueue(false);
    try {
      const result = await data.onGenerate({
        prompt,
        nodeId: id,
        imageProvider,
        modelVersion,
        ratio,
        resolutionType,
        count,
        onEachImage: (url) => {
          if (token !== activeGenerateTokenRef.current) return;
          setResultImageUrls((prev) => [...prev, url]);
        },
        onStreamProgress: (ev) => {
          if (token !== activeGenerateTokenRef.current) return;
          const inQueue = isProgressQueuePhase(ev);
          setStreamInQueue(inQueue);
          setStreamStatusLine(formatGenerateProgressLine(ev));
          setProgress((prev) => computeProgressFromStreamEvent(ev, prev));
        },
      });
      if (token !== activeGenerateTokenRef.current) return;
      const urls = Array.isArray(result?.imageUrls) ? result.imageUrls : [];
      if (urls.length > 0) {
        setResultImageUrls(urls);
        setResultImageUrl(null);
      } else if (result?.firstImageUrl) {
        setResultImageUrl(result.firstImageUrl);
        setResultImageUrls([]);
      } else {
        setLocalError("未收到生成的图片，请稍后重试。");
      }
      const usage = (result as {
        usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number } | null;
      })?.usage ?? null;
      setLastUsage(usage);
      if (usage?.total_tokens) {
        try {
          localStorage.setItem(
            "jimengpro-external-image-api-last-usage-v1",
            JSON.stringify({ ...usage, model: modelVersion, at: Date.now() })
          );
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      if (token !== activeGenerateTokenRef.current) return;
      setLocalError(error instanceof Error ? error.message : "生成失败");
    } finally {
      if (token !== activeGenerateTokenRef.current) return;
      setLoading(false);
      setActiveTaskId(null);
      setTimeout(() => setProgress(0), 400);
    }
  }, [count, data, editorText, id, imageProvider, modelVersion, ratio, resolutionType]);

  return (
    <div
      className={[
        "jimeng-canvas-node-drag-handle relative w-[420px] overflow-visible rounded-xl border border-zinc-600 bg-zinc-800 text-white shadow-[0_12px_40px_rgba(0,0,0,0.72)]",
        selected ? "ring-2 ring-zinc-300 ring-offset-2 ring-offset-black" : "",
      ].join(" ")}
    >
      <div className="space-y-3 p-3">
        <textarea
          value={editorText}
          onChange={(e) => setEditorText(e.target.value)}
          placeholder="输入生图提示词"
          className="nodrag nopan min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-zinc-400/35 focus:ring"
        />

        {data.connectedImages && data.connectedImages.length > 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-300">
            已连接 {data.connectedImages.length} 个素材。
            {imageProvider === "aiwanwu"
              ? " 外部图片通道会按当前厂商自动匹配参考图提交方式。"
              : ""}
          </div>
        ) : null}

        {localError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {localError}
          </div>
        ) : null}

        <div
          className="flex min-h-14 items-center justify-between gap-2 rounded-[18px] bg-zinc-900 p-2"
          data-testid="canvas-node-generation-action-bar"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              className={[
                "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition-colors",
                imageProvider === "dreamina"
                  ? "bg-zinc-600 text-white"
                  : "border border-zinc-700 bg-zinc-700 text-zinc-300 hover:bg-zinc-600 hover:text-white",
              ].join(" ")}
              onClick={() => {
                setImageProvider("dreamina");
                setModelVersion("5.0");
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>即梦</span>
            </button>
            <button
              type="button"
              className={[
                "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition-colors",
                imageProvider === "aiwanwu"
                  ? "bg-zinc-600 text-white"
                  : "border border-zinc-700 bg-zinc-700 text-zinc-300 hover:bg-zinc-600 hover:text-white",
              ].join(" ")}
              onClick={() => {
                setImageProvider("aiwanwu");
                setModelVersion(externalImageModels[0] || "gpt-image-2-c");
              }}
            >
              <Server className="h-3.5 w-3.5" />
              <span>GPT</span>
            </button>
            <button
              type="button"
              className="inline-flex h-8 max-w-[180px] items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-700 px-2 text-[11px] font-semibold text-zinc-100"
              onClick={() => setModelMenuOpen((v) => !v)}
            >
              <span className="truncate">{modelVersion}</span>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            {modelMenuOpen ? (
              <div className="absolute bottom-full left-24 z-50 mb-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl">
                {currentModels.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-800"
                    onClick={() => {
                      setModelVersion(m.value);
                      setModelMenuOpen(false);
                    }}
                  >
                    <div className="text-sm text-white">{m.title}</div>
                    <div className="text-[11px] text-zinc-400">{m.desc}</div>
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-700 px-2 text-[11px] font-semibold text-zinc-100"
              onClick={() => setSizeMenuOpen((v) => !v)}
            >
              <span>{ratio} · {resolutionType}</span>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            {sizeMenuOpen ? (
              <div className="absolute bottom-full left-[304px] z-50 mb-1 rounded-xl border border-zinc-800 bg-zinc-950 p-2 shadow-2xl">
                <div className="mb-2 text-[11px] text-zinc-400">比例</div>
                <div className="grid grid-cols-4 gap-1">
                  {RATIO_OPTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={[
                        "rounded-md border px-2 py-1 text-[11px]",
                        ratio === r
                          ? "border-zinc-400 bg-zinc-600 text-white"
                          : "border-zinc-700 text-zinc-300 hover:bg-zinc-800",
                      ].join(" ")}
                      onClick={() => setRatio(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div className="mb-2 mt-3 text-[11px] text-zinc-400">画质</div>
                <div className="flex gap-1">
                  {["2k", "4k"].map((q) => (
                    <button
                      key={q}
                      type="button"
                      className={[
                        "rounded-md border px-3 py-1 text-[11px]",
                        resolutionType === q
                          ? "border-zinc-400 bg-zinc-600 text-white"
                          : "border-zinc-700 text-zinc-300 hover:bg-zinc-800",
                      ].join(" ")}
                      onClick={() => setResolutionType(q)}
                    >
                      {q === "4k" ? "3K" : "2K"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className="inline-flex h-8 min-w-[48px] items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-700 px-2 text-[11px] font-semibold text-zinc-100"
              onClick={() => setCountMenuOpen((v) => !v)}
            >
              {count}x
              <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
            </button>
            {countMenuOpen ? (
              <div className="absolute bottom-full right-28 z-50 mb-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl">
                {[1, 2, 4, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="block w-full rounded-lg px-3 py-2 text-left text-[11px] text-zinc-100 hover:bg-zinc-800"
                    onClick={() => {
                      setCount(n);
                      setCountMenuOpen(false);
                    }}
                  >
                    {n} 张
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {imageProvider === "aiwanwu" ? (
              <div className="inline-flex h-10 min-w-[112px] items-center justify-center rounded-xl border border-white/12 bg-white/[0.06] px-3 text-[11px] font-semibold text-zinc-100">
                {lastUsage?.total_tokens ? `${lastUsage.total_tokens} tokens` : "--"}
              </div>
            ) : null}
            {currentDisplayUrl ? (
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-700 text-zinc-100"
                onClick={() => downloadMediaUrls([currentDisplayUrl], `prompt-${id}`)}
                title="下载当前结果"
              >
                <Download className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              disabled={loading}
              onClick={() => void beginGenerate()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-700 text-white shadow-lg ring-1 ring-zinc-500 disabled:bg-zinc-900 disabled:text-zinc-500"
              title="生成"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-300">
            <div>任务：{activeTaskId ?? "--"}</div>
            <div className="mt-1">{streamStatusLine || "处理中..."}</div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
              <div className="h-full rounded-full bg-zinc-200 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}

        {currentDisplayUrl ? (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentDisplayUrl} alt="" className="h-[240px] w-full object-cover" draggable={false} />
          </div>
        ) : (
          <div className="flex h-[240px] items-center justify-center rounded-xl border border-white/10 bg-black/20 text-sm text-zinc-500">
            暂无生成结果
          </div>
        )}
      </div>
    </div>
  );
}
