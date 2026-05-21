import {
  AIWANWU_DEFAULT_TEXT_MODEL,
  aiwanwuFetch,
  generateAiwanwuText,
} from "@/lib/aiwanwu";
import { buildCanvasAgentKnowledgePrompt } from "@/lib/canvasAgentKnowledge";
import {
  CANVAS_AGENT_IMAGE_RATIOS,
  CANVAS_AGENT_IMAGE_RESOLUTIONS,
  CANVAS_AGENT_VIDEO_RATIOS,
  CANVAS_AGENT_VIDEO_RESOLUTIONS,
  type CanvasAgentAction,
  type CanvasAgentDefaults,
  type CanvasAgentRequest,
  type CanvasAgentResponse,
} from "@/lib/canvasAgentTypes";

export const runtime = "nodejs";

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_VIDEO_MODEL = "seedance2.0fast";

function clipText(input: string, max = 600) {
  const text = input.trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function normalizeInt(value: unknown, fallback: number, min: number, max: number) {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
    if (["0", "false", "no", "off"].includes(v)) return false;
  }
  return fallback;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function pickOneOf<T extends readonly string[]>(
  value: unknown,
  options: T,
  fallback: T[number]
): T[number] {
  const text = normalizeString(value);
  return text && options.includes(text as T[number]) ? (text as T[number]) : fallback;
}

function pickImageProvider(
  value: unknown,
  fallback: "dreamina" | "aiwanwu"
): "dreamina" | "aiwanwu" {
  return value === "aiwanwu" ? "aiwanwu" : fallback;
}

function safeParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const direct = safeParseJsonObject(raw);
  if (direct) return direct;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = safeParseJsonObject(fenced[1]);
    if (parsed) return parsed;
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return safeParseJsonObject(raw.slice(firstBrace, lastBrace + 1));
  }

  return null;
}

function canvasSummaryToPrompt(summary: CanvasAgentRequest["canvasSummary"]) {
  if (!summary) return "Canvas summary: empty.";

  const nodeLines = summary.nodes.slice(0, 24).map((node) => {
    const parts = [
      `id=${node.id}`,
      `type=${node.type}`,
      `label=${clipText(node.label || node.type, 40)}`,
      typeof node.nodeName === "string" && node.nodeName ? `nodeName=${node.nodeName}` : null,
      typeof node.promptText === "string" && node.promptText
        ? `prompt=${clipText(node.promptText, 90)}`
        : null,
      typeof node.modelVersion === "string" && node.modelVersion
        ? `model=${node.modelVersion}`
        : null,
      typeof node.imageProvider === "string" ? `imageProvider=${node.imageProvider}` : null,
      typeof node.externalApiProviderId === "string"
        ? `provider=${node.externalApiProviderId}`
        : null,
      typeof node.operation === "string" ? `operation=${node.operation}` : null,
      typeof node.ratio === "string" ? `ratio=${node.ratio}` : null,
      typeof node.resolutionType === "string" ? `resolution=${node.resolutionType}` : null,
      typeof node.count === "number" ? `count=${node.count}` : null,
      typeof node.durationSeconds === "number" ? `duration=${node.durationSeconds}s` : null,
      typeof node.referenceMode === "string" ? `referenceMode=${node.referenceMode}` : null,
      typeof node.status === "string" ? `status=${node.status}` : null,
      typeof node.outputCount === "number" ? `outputCount=${node.outputCount}` : null,
      typeof node.streamStatusLine === "string" && node.streamStatusLine
        ? `stream=${clipText(node.streamStatusLine, 60)}`
        : null,
      Array.isArray(node.connectedNodeIds) && node.connectedNodeIds.length > 0
        ? `connected=${node.connectedNodeIds.join(",")}`
        : null,
      Array.isArray(node.materialOrder) && node.materialOrder.length > 0
        ? `materialOrder=${node.materialOrder.join(",")}`
        : null,
      node.selected ? "selected=true" : null,
      node.hasRenderableMedia ? "hasMedia=true" : null,
      node.canReference ? "canReference=true" : null,
      typeof node.error === "string" && node.error ? `error=${clipText(node.error, 80)}` : null,
    ].filter(Boolean);
    return `- ${parts.join(", ")}`;
  });

  const edgeLines = (summary.edges ?? []).slice(0, 28).map((edge) => {
    return `- ${edge.sourceId}(${edge.sourceType ?? "unknown"}) -> ${edge.targetId}(${edge.targetType ?? "unknown"}), sourceHandle=${edge.sourceHandle ?? "none"}, targetHandle=${edge.targetHandle ?? "none"}`;
  });

  return [
    `Canvas has ${summary.nodeCount} nodes and ${summary.edgeCount} edges.`,
    summary.selectedNodeIds.length > 0
      ? `Selected nodes: ${summary.selectedNodeIds.join(", ")}`
      : "Selected nodes: none.",
    summary.externalApiProviderId
      ? `Current GPT provider: ${summary.externalApiProviderId}`
      : "Current GPT provider: unknown.",
    summary.externalApiImageModel
      ? `Current GPT image model: ${summary.externalApiImageModel}`
      : "Current GPT image model: unknown.",
    summary.externalApiTextModel
      ? `Current GPT text model: ${summary.externalApiTextModel}`
      : "Current GPT text model: unknown.",
    "Node summary:",
    ...nodeLines,
    "Edge summary:",
    ...edgeLines,
  ].join("\n");
}

function buildSystemPrompt(defaults: CanvasAgentDefaults) {
  return [
    "You are the canvas copilot for a node-based creative app.",
    "You must understand the canvas deeply: node semantics, model capabilities, edit operations, connection graph, current runtime state, and what each model is good for.",
    "When the user asks about the current canvas, current models, node behavior, or why something is connected or running, answer directly from the realtime canvas summary plus the built-in product knowledge.",
    "When deciding image/video actions, choose the most suitable modelVersion and imageProvider when the user did not specify one.",
    "When the user explicitly asks for generation and has not yet chosen between canvas generation and chat-window direct generation, return ask_generation_path.",
    "Output must be a single JSON object. No markdown. No code fences.",
    'Schema: {"reply":"natural reply","reasoningSummary":"short internal summary","action":{"type":"chat|ask_generation_path|generate_image|generate_video", ...}}',
    "If action.type=chat, do not include generation-only fields.",
    "If action.type=ask_generation_path, include target=image|video and prompt.",
    "If action.type=generate_image, include prompt and optionally count, ratio, resolutionType, imageProvider, modelVersion, referenceNodeIds, targetNodeId.",
    "If action.type=generate_video, include prompt and optionally count, ratio, resolutionType, durationSeconds, withAudio, modelVersion, referenceNodeIds, targetNodeId.",
    `Default image settings: count=${defaults.imageCount}, ratio=${defaults.imageRatio}, resolutionType=${defaults.imageResolution}`,
    `Default video settings: count=${defaults.videoCount}, ratio=${defaults.videoRatio}, resolutionType=${defaults.videoResolution}, durationSeconds=${defaults.videoDurationSeconds}, withAudio=${defaults.videoWithAudio}`,
    `Allowed image ratios: ${CANVAS_AGENT_IMAGE_RATIOS.join(", ")}`,
    `Allowed image resolutions: ${CANVAS_AGENT_IMAGE_RESOLUTIONS.join(", ")}`,
    `Allowed video ratios: ${CANVAS_AGENT_VIDEO_RATIOS.join(", ")}`,
    `Allowed video resolutions: ${CANVAS_AGENT_VIDEO_RESOLUTIONS.join(", ")}`,
    "If the user ultimately chooses canvas generation, preserve the user's plain-language wording as the prompt unless they explicitly ask you to rewrite or optimize it.",
    "If the user ultimately chooses chat-window direct image generation, you may make the prompt slightly more generation-ready, but do not over-embellish it.",
    "Keep reply concise, natural, and helpful.",
    buildCanvasAgentKnowledgePrompt(),
  ].join("\n");
}

function buildUserPrompt(input: CanvasAgentRequest) {
  const historyLines = (input.history ?? [])
    .slice(-10)
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${clipText(item.text, 400)}`);
  return [
    canvasSummaryToPrompt(input.canvasSummary),
    historyLines.length > 0 ? `Recent conversation:\n${historyLines.join("\n")}` : "Recent conversation: none.",
    `Latest user message: ${input.message.trim()}`,
    "Reply with one JSON object that best answers the user and plans the right canvas behavior.",
  ].join("\n\n");
}

function buildTextUserContent(input: CanvasAgentRequest) {
  const trimmedImages = Array.isArray(input.directImageDataUrls)
    ? input.directImageDataUrls
        .map((url) => (typeof url === "string" ? url.trim() : ""))
        .filter((url): url is string => Boolean(url))
    : [];
  const prompt = buildUserPrompt(input);
  return trimmedImages.length > 0
    ? [
        { type: "text", text: prompt },
        ...trimmedImages.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
      ]
    : prompt;
}

function normalizeStreamDeltaContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("");
}

function extractReplyTextFromPartialJson(raw: string) {
  const keyIndex = raw.indexOf('"reply"');
  if (keyIndex < 0) return null;
  let cursor = keyIndex + '"reply"'.length;
  while (cursor < raw.length && /\s/.test(raw[cursor]!)) cursor += 1;
  if (raw[cursor] !== ":") return null;
  cursor += 1;
  while (cursor < raw.length && /\s/.test(raw[cursor]!)) cursor += 1;
  if (raw[cursor] !== '"') return null;
  cursor += 1;

  let out = "";
  let escaped = false;
  for (; cursor < raw.length; cursor += 1) {
    const ch = raw[cursor]!;
    if (escaped) {
      if (ch === "n") out += "\n";
      else if (ch === "r") out += "\r";
      else if (ch === "t") out += "\t";
      else if (ch === "b") out += "\b";
      else if (ch === "f") out += "\f";
      else if (ch === "u") {
        const hex = raw.slice(cursor + 1, cursor + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
        out += String.fromCharCode(parseInt(hex, 16));
        cursor += 4;
      } else {
        out += ch;
      }
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
  }
  return out.length > 0 ? out : null;
}

function normalizeAction(raw: Record<string, unknown>, defaults: CanvasAgentDefaults): CanvasAgentAction {
  const rawAction =
    raw.action && typeof raw.action === "object" && !Array.isArray(raw.action)
      ? (raw.action as Record<string, unknown>)
      : raw;
  const type = normalizeString(rawAction.type);
  const reply = normalizeString(rawAction.reply || raw.reply);
  const reasoningSummary = normalizeString(rawAction.reasoningSummary || raw.reasoningSummary);

  if (type === "generate_video") {
    return {
      type: "generate_video",
      prompt: normalizeString(rawAction.prompt),
      reply: reply || undefined,
      reasoningSummary: reasoningSummary || undefined,
      count: normalizeInt(rawAction.count, defaults.videoCount, 1, 2),
      ratio: pickOneOf(rawAction.ratio, CANVAS_AGENT_VIDEO_RATIOS, defaults.videoRatio),
      resolutionType: pickOneOf(
        rawAction.resolutionType,
        CANVAS_AGENT_VIDEO_RESOLUTIONS,
        defaults.videoResolution
      ),
      durationSeconds: normalizeInt(rawAction.durationSeconds, defaults.videoDurationSeconds, 2, 15),
      withAudio: normalizeBool(rawAction.withAudio, defaults.videoWithAudio),
      modelVersion: normalizeString(rawAction.modelVersion) || DEFAULT_VIDEO_MODEL,
      targetNodeId: normalizeString(rawAction.targetNodeId) || undefined,
      referenceNodeIds: Array.isArray(rawAction.referenceNodeIds)
        ? rawAction.referenceNodeIds.map((item) => normalizeString(item)).filter(Boolean)
        : undefined,
    };
  }

  if (type === "ask_generation_path") {
    const target = normalizeString(rawAction.target) === "video" ? "video" : "image";
    return {
      type: "ask_generation_path",
      target,
      prompt: normalizeString(rawAction.prompt),
      reply: reply || undefined,
      reasoningSummary: reasoningSummary || undefined,
      count: normalizeInt(
        rawAction.count,
        target === "video" ? defaults.videoCount : defaults.imageCount,
        1,
        target === "video" ? 2 : 8
      ),
      ratio:
        target === "video"
          ? pickOneOf(rawAction.ratio, CANVAS_AGENT_VIDEO_RATIOS, defaults.videoRatio)
          : pickOneOf(rawAction.ratio, CANVAS_AGENT_IMAGE_RATIOS, defaults.imageRatio),
      resolutionType:
        target === "video"
          ? pickOneOf(
              rawAction.resolutionType,
              CANVAS_AGENT_VIDEO_RESOLUTIONS,
              defaults.videoResolution
            )
          : pickOneOf(
              rawAction.resolutionType,
              CANVAS_AGENT_IMAGE_RESOLUTIONS,
              defaults.imageResolution
            ),
      durationSeconds: normalizeInt(rawAction.durationSeconds, defaults.videoDurationSeconds, 2, 15),
      withAudio: normalizeBool(rawAction.withAudio, defaults.videoWithAudio),
      imageProvider: pickImageProvider(rawAction.imageProvider, "dreamina"),
      modelVersion: normalizeString(rawAction.modelVersion) || (target === "video" ? DEFAULT_VIDEO_MODEL : DEFAULT_IMAGE_MODEL),
      targetNodeId: normalizeString(rawAction.targetNodeId) || undefined,
      referenceNodeIds: Array.isArray(rawAction.referenceNodeIds)
        ? rawAction.referenceNodeIds.map((item) => normalizeString(item)).filter(Boolean)
        : undefined,
    };
  }

  if (type === "generate_image") {
    return {
      type: "generate_image",
      prompt: normalizeString(rawAction.prompt),
      reply: reply || undefined,
      reasoningSummary: reasoningSummary || undefined,
      count: normalizeInt(rawAction.count, defaults.imageCount, 1, 8),
      ratio: pickOneOf(rawAction.ratio, CANVAS_AGENT_IMAGE_RATIOS, defaults.imageRatio),
      resolutionType: pickOneOf(
        rawAction.resolutionType,
        CANVAS_AGENT_IMAGE_RESOLUTIONS,
        defaults.imageResolution
      ),
      imageProvider: pickImageProvider(rawAction.imageProvider, "dreamina"),
      modelVersion: normalizeString(rawAction.modelVersion) || DEFAULT_IMAGE_MODEL,
      targetNodeId: normalizeString(rawAction.targetNodeId) || undefined,
      referenceNodeIds: Array.isArray(rawAction.referenceNodeIds)
        ? rawAction.referenceNodeIds.map((item) => normalizeString(item)).filter(Boolean)
        : undefined,
    };
  }

  return { type: "chat" };
}

function buildFinalResponse(
  rawText: string,
  defaults: CanvasAgentDefaults,
  model: string
): CanvasAgentResponse {
  const parsed = extractFirstJsonObject(rawText);
  if (!parsed) {
    return {
      ok: true,
      reply: rawText.trim() || "I can continue helping with the canvas.",
      reasoningSummary: null,
      action: { type: "chat" },
      model,
    };
  }

  const action = normalizeAction(parsed, defaults);
  const reply =
    normalizeString(parsed.reply) ||
    ("reply" in action && typeof action.reply === "string" && action.reply.trim()
      ? action.reply.trim()
      : action.type === "chat"
        ? "I can continue helping with the canvas."
        : "I can execute this on the canvas.");
  const reasoningSummary = normalizeString(parsed.reasoningSummary) || null;

  if (
    (action.type === "generate_image" || action.type === "generate_video") &&
    !action.prompt.trim()
  ) {
    return {
      ok: true,
      reply,
      reasoningSummary:
        reasoningSummary ||
        "Generation intent was detected, but no valid prompt text was returned. Falling back to chat reply.",
      action: { type: "chat" },
      model,
    };
  }

  return {
    ok: true,
    reply,
    reasoningSummary,
    action,
    model,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CanvasAgentRequest | null;
    const message = body?.message?.trim() || "";
    if (!message) {
      return Response.json({ ok: false, error: "`message` must not be empty" }, { status: 400 });
    }

    const defaults: CanvasAgentDefaults = {
      imageCount: body?.defaults?.imageCount ?? 1,
      imageRatio: body?.defaults?.imageRatio ?? "16:9",
      imageResolution: body?.defaults?.imageResolution ?? "2k",
      videoCount: body?.defaults?.videoCount ?? 1,
      videoRatio: body?.defaults?.videoRatio ?? "16:9",
      videoResolution: body?.defaults?.videoResolution ?? "720p",
      videoDurationSeconds: body?.defaults?.videoDurationSeconds ?? 5,
      videoWithAudio: body?.defaults?.videoWithAudio ?? false,
    };

    const providerId =
      body?.providerId === "foropencode" || body?.providerId === "default_gpt"
        ? body.providerId
        : undefined;
    const model = body?.model?.trim() || AIWANWU_DEFAULT_TEXT_MODEL;
    const wantsStream = request.headers.get("x-jimeng-stream") === "1";

    if (wantsStream) {
      const upstream = await aiwanwuFetch(
        "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            stream: true,
            messages: [
              { role: "system", content: buildSystemPrompt(defaults) },
              { role: "user", content: buildTextUserContent({ ...body, message }) },
            ],
          }),
        },
        providerId
      );

      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => "");
        return Response.json(
          {
            ok: false,
            error: text.trim() || "Canvas agent upstream request failed",
          },
          { status: 500 }
        );
      }

      const encoder = new TextEncoder();
      const reader = upstream.body.getReader();
      let upstreamBuffer = "";
      let rawText = "";
      let lastReplySent = "";
      let finalModel = model;

      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              const payload = buildFinalResponse(rawText, defaults, finalModel);
              controller.enqueue(
                encoder.encode(JSON.stringify({ event: "done", payload }) + "\n")
              );
              controller.close();
              return;
            }

            upstreamBuffer += new TextDecoder().decode(value, { stream: true });
            const lines = upstreamBuffer.split("\n");
            upstreamBuffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (!data) continue;
              if (data === "[DONE]") {
                const payload = buildFinalResponse(rawText, defaults, finalModel);
                controller.enqueue(
                  encoder.encode(JSON.stringify({ event: "done", payload }) + "\n")
                );
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(data) as {
                  model?: string;
                  choices?: Array<{ delta?: { content?: unknown } }>;
                };
                if (typeof parsed.model === "string" && parsed.model.trim()) {
                  finalModel = parsed.model.trim();
                }
                const chunk = normalizeStreamDeltaContent(parsed.choices?.[0]?.delta?.content);
                if (!chunk) continue;
                rawText += chunk;
                const currentReply = extractReplyTextFromPartialJson(rawText);
                if (currentReply != null && currentReply !== lastReplySent) {
                  lastReplySent = currentReply;
                  controller.enqueue(
                    encoder.encode(
                      JSON.stringify({
                        event: "reply_delta",
                        reply: currentReply,
                        chunk,
                      }) + "\n"
                    )
                  );
                }
              } catch {
                /* ignore malformed chunk */
              }
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Canvas agent stream failed";
            controller.enqueue(
              encoder.encode(JSON.stringify({ event: "error", message }) + "\n")
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    const result = await generateAiwanwuText({
      prompt: buildUserPrompt({ ...body, message }),
      model,
      providerId,
      systemPrompt: buildSystemPrompt(defaults),
      imageDataUrls:
        Array.isArray(body?.directImageDataUrls) && body.directImageDataUrls.length > 0
          ? body.directImageDataUrls
          : undefined,
    });

    return Response.json(buildFinalResponse(result.text, defaults, result.model || model));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Canvas agent request failed";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
