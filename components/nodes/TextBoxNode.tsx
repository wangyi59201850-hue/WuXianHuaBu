import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type NodeProps, useReactFlow } from "reactflow";
import { Copy, MessageSquareText, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import {
  normalizeExternalImageApiProviderId,
  type ExternalImageApiProviderId,
} from "@/lib/externalImageApiShared";

export type TextBoxNodeData = {
  nodeName?: string;
  promptText?: string;
  model?: string;
  providerId?: ExternalImageApiProviderId;
  responseText?: string;
  sentTexts?: string[];
  error?: string | null;
  isLoading?: boolean;
  availableModels?: string[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
};

const FALLBACK_TEXT_MODELS = ["gpt-5.4", "gpt-5.5", "gpt-4.1", "gpt-4o-mini", "o3"];
type ExternalApiConfigResponse = {
  config?: {
    activeProviderId?: string;
    textModel?: string;
    providers?: Partial<Record<ExternalImageApiProviderId, { textModel?: string }>>;
  };
};

export function TextBoxNode({ id, data, selected }: NodeProps<TextBoxNodeData>) {
  const { setNodes } = useReactFlow();
  const loadingModelsRef = useRef(false);
  const [draftPrompt, setDraftPrompt] = useState(data.promptText || "");
  const [isComposing, setIsComposing] = useState(false);

  const suppressEditorContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const keepWheelForEditor = useCallback((event: React.WheelEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const patchNodeData = useCallback(
    (patch: Partial<TextBoxNodeData>) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...(node.data as TextBoxNodeData),
                  ...patch,
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const loadModels = useCallback(async () => {
    if (loadingModelsRef.current) return;
    loadingModelsRef.current = true;
    try {
      const configResp = await fetch("/api/external-image-config", {
        cache: "no-store",
      }).catch(() => null);
      const configJson = configResp
        ? ((await configResp.json().catch(() => null)) as ExternalApiConfigResponse | null)
        : null;
      const providerId = normalizeExternalImageApiProviderId(
        configJson?.config?.activeProviderId
      );
      const configuredModel =
        typeof configJson?.config?.providers?.[providerId]?.textModel === "string"
          ? configJson.config.providers[providerId]!.textModel!.trim()
          : typeof configJson?.config?.textModel === "string"
            ? configJson.config.textModel.trim()
            : "";

      const resp = await fetch(
        `/api/aiwanwu/models?kind=text&providerId=${encodeURIComponent(providerId)}`,
        { cache: "no-store" }
      );
      const json = (await resp.json().catch(() => null)) as { ok?: boolean; models?: string[] } | null;
      const models =
        Array.isArray(json?.models) && json.models.length > 0 ? json.models : FALLBACK_TEXT_MODELS;
      const nextModel =
        configuredModel && models.includes(configuredModel)
          ? configuredModel
          : data.model && models.includes(data.model)
            ? data.model
            : models[0];
      patchNodeData({
        availableModels: models,
        model: nextModel,
        providerId,
      });
    } catch {
      patchNodeData({
        availableModels: FALLBACK_TEXT_MODELS,
        model: data.model || FALLBACK_TEXT_MODELS[0],
        providerId: normalizeExternalImageApiProviderId(data.providerId),
      });
    } finally {
      loadingModelsRef.current = false;
    }
  }, [data.model, data.providerId, patchNodeData]);

  useEffect(() => {
    void loadModels();
    const onExternalConfigChanged = () => {
      void loadModels();
    };
    window.addEventListener("jimengpro:external-api-config-changed", onExternalConfigChanged);
    return () => {
      window.removeEventListener("jimengpro:external-api-config-changed", onExternalConfigChanged);
    };
  }, [loadModels]);

  useEffect(() => {
    if (isComposing) return;
    setDraftPrompt(data.promptText || "");
  }, [data.promptText, isComposing]);

  const availableModels =
    data.availableModels && data.availableModels.length > 0
      ? data.availableModels
      : FALLBACK_TEXT_MODELS;
  const currentModel =
    data.model && availableModels.includes(data.model) ? data.model : availableModels[0];
  const currentProviderId = normalizeExternalImageApiProviderId(data.providerId);
  const displayNodeName = data.nodeName || "文本编辑";

  const outputText = useMemo(() => {
    if (typeof data.responseText === "string" && data.responseText.trim()) {
      return data.responseText;
    }
    if (Array.isArray(data.sentTexts) && data.sentTexts.length > 0) {
      return data.sentTexts
        .filter((item) => typeof item === "string" && item.trim().length > 0)
        .join("\n\n");
    }
    return "";
  }, [data.responseText, data.sentTexts]);

  const runGenerate = useCallback(async () => {
    const prompt = draftPrompt.trim();
    if (!prompt) {
      patchNodeData({ error: "请输入要发送的文本。" });
      return;
    }

    patchNodeData({
      error: null,
      isLoading: true,
      promptText: draftPrompt,
      model: currentModel,
      providerId: currentProviderId,
    });

    try {
      const resp = await fetch("/api/aiwanwu/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          model: currentModel,
          providerId: currentProviderId,
        }),
      });

      const json = (await resp.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            text?: string;
            model?: string;
            usage?: TextBoxNodeData["usage"];
          }
        | null;

      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error || "文本生成失败");
      }

      const nextText = typeof json.text === "string" ? json.text : "";
      patchNodeData({
        error: nextText.trim() ? null : "模型没有返回文本内容。",
        isLoading: false,
        responseText: nextText,
        sentTexts: [],
        model: typeof json.model === "string" && json.model.trim() ? json.model : currentModel,
        providerId: currentProviderId,
        usage: json.usage ?? null,
      });
    } catch (error) {
      patchNodeData({
        error: error instanceof Error ? error.message : "文本生成失败",
        isLoading: false,
      });
    }
  }, [currentModel, currentProviderId, draftPrompt, patchNodeData]);

  const copyResult = useCallback(async () => {
    const text = outputText.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }, [outputText]);

  const clearPrompt = useCallback(() => {
    setDraftPrompt("");
    patchNodeData({ promptText: "", error: null });
  }, [patchNodeData]);

  return (
    <div className="group/text-node relative w-[420px] overflow-visible">
      <div
        className={[
          "relative overflow-hidden rounded-xl border border-zinc-600 bg-zinc-800 text-white shadow-[0_12px_40px_rgba(0,0,0,0.72)]",
          selected
            ? "ring-1 ring-zinc-300/90 ring-offset-2 ring-offset-black shadow-[0_10px_32px_rgba(0,0,0,0.52),0_0_12px_rgba(255,255,255,0.06)]"
            : "",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <MessageSquareText className="h-4 w-4 text-zinc-200" />
            <span>{displayNodeName}</span>
            <span className="rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
              测试
            </span>
          </div>
          <button
            type="button"
            className="nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
            onClick={() => void loadModels()}
            title="刷新模型列表"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-3 p-3">
          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-zinc-400">推理模型</label>
            <select
              className="nodrag nopan w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white outline-none ring-zinc-400/35 focus:ring"
              value={currentModel}
              onChange={(e) => patchNodeData({ model: e.target.value })}
            >
              {availableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-zinc-400">输入文本</label>
            <textarea
              className="nodrag nopan min-h-[120px] w-full resize-y rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm leading-relaxed text-white outline-none ring-zinc-400/35 placeholder:text-zinc-500 focus:ring"
              placeholder="输入要发送给模型的文本。"
              value={draftPrompt}
              onContextMenu={suppressEditorContextMenu}
              onWheel={keepWheelForEditor}
              onChange={(e) => {
                const next = e.target.value;
                setDraftPrompt(next);
                if (!isComposing) patchNodeData({ promptText: next });
              }}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={(e) => {
                const next = e.currentTarget.value;
                setIsComposing(false);
                setDraftPrompt(next);
                patchNodeData({ promptText: next });
              }}
              onBlur={(e) => {
                const next = e.currentTarget.value;
                setDraftPrompt(next);
                patchNodeData({ promptText: next });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void runGenerate();
                }
              }}
            />
            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span>快捷键：Ctrl / Cmd + Enter 发送</span>
              <span>{draftPrompt.length} 字</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="nodrag nopan inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-100 px-4 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void runGenerate()}
              disabled={Boolean(data.isLoading)}
            >
              {data.isLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span>{data.isLoading ? "生成中" : "生成文本"}</span>
            </button>
            <button
              type="button"
              className="nodrag nopan inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-200 hover:bg-white/10"
              onClick={clearPrompt}
            >
              <Trash2 className="h-4 w-4" />
              <span>清空输入</span>
            </button>
            <button
              type="button"
              className="nodrag nopan inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-200 hover:bg-white/10 disabled:opacity-50"
              onClick={() => void copyResult()}
              disabled={!outputText.trim()}
            >
              <Copy className="h-4 w-4" />
              <span>复制输出</span>
            </button>
          </div>

          {data.error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {data.error}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-medium text-zinc-400">模型输出</label>
              {data.usage ? (
                <span className="text-[10px] text-zinc-500">
                  Tokens {data.usage.total_tokens ?? "-"}
                </span>
              ) : null}
            </div>
            <textarea
              className="nodrag nopan min-h-[170px] w-full resize-y rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500"
              value={outputText}
              readOnly
              onContextMenu={suppressEditorContextMenu}
              onWheel={keepWheelForEditor}
              placeholder="模型返回的文本会显示在这里，可以直接选中复制。"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
