"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Copy,
  Image as ImageIcon,
  Loader2,
  Pause,
  SendHorizontal,
  Upload,
  X,
} from "lucide-react";
import type { CanvasAgentHistoryMessage } from "@/lib/canvasAgentTypes";

export const CANVAS_AGENT_MEDIA_DRAG_MIME = "application/x-jimeng-agent-media";

type CanvasAgentDockProps = {
  messages: CanvasAgentHistoryMessage[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onInterrupt?: () => void;
  canInterrupt?: boolean;
  attachedImageDataUrls: string[];
  onPickImages: (files: FileList | null) => void;
  onRemoveAttachedImage: (index: number) => void;
  modelOptions: string[];
  selectedModel: string;
  onSelectedModelChange: (value: string) => void;
  busy?: boolean;
  busyLabel?: string | null;
  statusLabel?: string | null;
  modelLabel?: string | null;
};

function messageKey(message: CanvasAgentHistoryMessage, index: number) {
  return message.id ?? `${message.role}-${index}-${message.text.slice(0, 18)}`;
}

export function CanvasAgentDock(props: CanvasAgentDockProps) {
  const {
    messages,
    draft,
    onDraftChange,
    onSubmit,
    onInterrupt,
    canInterrupt = false,
    attachedImageDataUrls,
    onPickImages,
    onRemoveAttachedImage,
    modelOptions,
    selectedModel,
    onSelectedModelChange,
    busy = false,
    busyLabel,
    statusLabel,
    modelLabel,
  } = props;

  const [open, setOpen] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectionCopyUi, setSelectionCopyUi] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visibleMessages = useMemo(
    () => (historyExpanded ? messages : messages.slice(-8)),
    [historyExpanded, messages]
  );
  const hasOverflowHistory = messages.length > 8;
  const hasStreamingMessage = messages.some((item) => item.isStreaming);
  const activeStreamingMessage = [...messages].reverse().find((item) => item.isStreaming) ?? null;
  const shouldShowBusyBubble = Boolean(
    busy && activeStreamingMessage && !(activeStreamingMessage.text ?? "").trim()
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleMessages, busy, statusLabel, open]);

  useEffect(() => {
    const updateSelectionUi = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (!text || selection?.rangeCount === 0) {
        setSelectionCopyUi(null);
        return;
      }
      if (!selection) {
        setSelectionCopyUi(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setSelectionCopyUi(null);
        return;
      }
      const root = rootRef.current;
      if (!root) {
        setSelectionCopyUi(null);
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const withinRoot =
        rect.bottom >= rootRect.top &&
        rect.top <= rootRect.bottom &&
        rect.right >= rootRect.left &&
        rect.left <= rootRect.right;
      if (!withinRoot) {
        setSelectionCopyUi(null);
        return;
      }
      setSelectionCopyUi({
        text,
        x: Math.min(window.innerWidth - 52, rect.right + 8),
        y: Math.max(12, rect.top - 8),
      });
    };

    document.addEventListener("selectionchange", updateSelectionUi);
    window.addEventListener("scroll", updateSelectionUi, true);
    return () => {
      document.removeEventListener("selectionchange", updateSelectionUi);
      window.removeEventListener("scroll", updateSelectionUi, true);
    };
  }, []);

  return (
    <>
      <div
        ref={rootRef}
        className="pointer-events-auto fixed inset-x-0 bottom-4 z-[86] flex justify-center px-4"
      >
        <div
          className={[
            "relative overflow-hidden border border-white/12 bg-zinc-950/86 shadow-[0_22px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-all duration-300",
            open ? "w-[min(92vw,820px)] rounded-[30px]" : "w-[min(38vw,240px)] rounded-[22px]",
            hasStreamingMessage
              ? "canvas-agent-dock-streaming border-white/18"
              : "",
          ].join(" ")}
        >
          <div className="relative flex items-center gap-3 px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-100">
              {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Bot className="h-4.5 w-4.5" />}
            </div>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setOpen((value) => !value)}
              title={open ? "收起智能体" : "展开智能体"}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-white">画布智能体</span>
                {modelLabel ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                    {modelLabel}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                {busyLabel || "点击展开，继续聊天或触发生图/生视频。"}
              </div>
            </button>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white"
              onClick={() => setOpen((value) => !value)}
              title={open ? "收起" : "展开"}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>

          {open ? (
            <>
              <div className="border-t border-white/8 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedModel}
                    onChange={(event) => onSelectedModelChange(event.target.value)}
                    className="h-9 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] text-zinc-200 outline-none transition-colors hover:bg-white/[0.06]"
                    title="选择智能体推理模型"
                  >
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  {statusLabel ? (
                    <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-300">
                      {statusLabel}
                    </div>
                  ) : null}
                  {hasOverflowHistory ? (
                    <button
                      type="button"
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                      onClick={() => setHistoryExpanded((value) => !value)}
                    >
                      {historyExpanded ? "收起历史" : "查看更多历史"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div
                ref={listRef}
                className={`overflow-y-auto px-4 pb-3 ${historyExpanded ? "max-h-[56vh]" : "max-h-[34vh]"}`}
              >
                <div className="space-y-3">
                  {messages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm leading-7 text-zinc-400">
                      直接说需求，涉及生图或生视频时会先弹一个小选择框。
                    </div>
                  ) : null}

                  {visibleMessages.map((message, index) => {
                    const isAssistant = message.role === "assistant";
                    return (
                      <div
                        key={messageKey(message, index)}
                        className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={[
                            "max-w-[min(90%,680px)] rounded-3xl px-4 py-3 text-sm leading-7 shadow-sm",
                            isAssistant
                              ? "border border-white/10 bg-white/[0.04] text-zinc-100"
                              : "bg-zinc-100 text-zinc-950",
                          ].join(" ")}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            void navigator.clipboard?.writeText(message.text);
                          }}
                          title="右键可复制当前这条消息"
                        >
                          <div className="whitespace-pre-wrap break-words">{message.text}</div>

                          {Array.isArray(message.mediaUrls) && message.mediaUrls.length > 0 ? (
                            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {message.mediaUrls.map((url) => (
                                <div
                                  key={url}
                                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/20"
                                  draggable
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "copy";
                                    event.dataTransfer.setData(
                                      CANVAS_AGENT_MEDIA_DRAG_MIME,
                                      JSON.stringify({
                                        url,
                                        mediaKind: message.mediaKind ?? "image",
                                      })
                                    );
                                    event.dataTransfer.setData("text/uri-list", url);
                                    event.dataTransfer.setData("text/plain", url);
                                  }}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={url}
                                    alt=""
                                    className="h-28 w-full cursor-zoom-in object-cover"
                                    draggable={false}
                                    onClick={() => setPreviewUrl(url)}
                                  />
                                  <button
                                    type="button"
                                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                                    onClick={() => setPreviewUrl(url)}
                                    title="放大查看"
                                  >
                                    <ImageIcon className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {shouldShowBusyBubble ? (
                    <div className="flex justify-start">
                      <div className="max-w-[min(90%,680px)] rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-200">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>{busyLabel || "思考中..."}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-white/8 px-4 py-4">
                <div className="flex items-end gap-3 rounded-[24px] border border-white/10 bg-white/[0.03] p-2">
                  <div className="flex flex-1 flex-col gap-2">
                    {attachedImageDataUrls.length > 0 ? (
                      <div className="flex flex-wrap gap-2 px-2 pt-1">
                        {attachedImageDataUrls.map((url, index) => (
                          <div
                            key={`${url}-${index}`}
                            className="group relative overflow-hidden rounded-2xl border border-white/10"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt=""
                              className="h-16 w-16 object-cover transition-transform duration-200 group-hover:scale-[1.04]"
                              draggable={false}
                              onClick={() => setPreviewUrl(url)}
                            />
                            <button
                              type="button"
                              className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70"
                              onClick={() => onRemoveAttachedImage(index)}
                              title="移除这张图片"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <textarea
                      value={draft}
                      onChange={(event) => onDraftChange(event.target.value)}
                      placeholder="描述你想做什么。"
                      className="min-h-[56px] flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-7 text-zinc-100 outline-none placeholder:text-zinc-500"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !busy) {
                        event.preventDefault();
                        onSubmit();
                      }
                    }}
                  />
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      onPickImages(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />

                  <button
                    type="button"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-200 transition-colors hover:bg-white/[0.08]"
                    onClick={() => fileInputRef.current?.click()}
                    title="上传图片"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </button>

                  {canInterrupt && onInterrupt ? (
                    <button
                      type="button"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-200 transition-colors hover:bg-white/[0.08]"
                      onClick={onInterrupt}
                      title="中断"
                    >
                      <Pause className="h-4 w-4" />
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-950 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-55"
                    onClick={onSubmit}
                    disabled={!draft.trim() || busy}
                    title="发送"
                  >
                    <SendHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {previewUrl ? (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/72 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="关闭预览"
            onClick={() => setPreviewUrl(null)}
          />
          <div className="relative z-10 max-h-[88vh] max-w-[92vw] overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/96 p-3 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="max-h-[80vh] max-w-[86vw] rounded-[20px] object-contain"
              draggable={false}
            />
          </div>
        </div>
      ) : null}

      {selectionCopyUi ? (
        <button
          type="button"
          className="fixed z-[97] inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-zinc-950/92 text-zinc-100 shadow-[0_12px_32px_rgba(0,0,0,0.42)] transition-colors hover:bg-zinc-900"
          style={{ left: selectionCopyUi.x, top: selectionCopyUi.y }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void navigator.clipboard?.writeText(selectionCopyUi.text)}
          title="复制选中文字"
        >
          <Copy className="h-4 w-4" />
        </button>
      ) : null}
    </>
  );
}
