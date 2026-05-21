import { AIWANWU_DEFAULT_TEXT_MODEL, aiwanwuFetch } from "@/lib/aiwanwu";
import type { CanvasAgentHistoryMessage, CanvasAgentRequest } from "@/lib/canvasAgentTypes";

export const runtime = "nodejs";

function clipText(input: string, max = 600) {
  const text = input.trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function buildUserPrompt(input: CanvasAgentRequest) {
  const historyLines = (input.history ?? [])
    .slice(-10)
    .map((item: CanvasAgentHistoryMessage) => {
      const role = item.role === "assistant" ? "助手" : "用户";
      return `${role}: ${clipText(item.text, 400)}`;
    });
  return [
    historyLines.length > 0 ? `最近对话：\n${historyLines.join("\n")}` : "最近对话：暂无。",
    `用户最新消息：${input.message.trim()}`,
    "请像一个自然的中文创作助手一样直接回复用户，不要输出 JSON，不要解释工具调用，不要暴露后台动作规划。",
    "如果用户在要求生图或生视频，你也只需要先自然回应，不要在这里解释流程。",
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CanvasAgentRequest | null;
    const message = body?.message?.trim() || "";
    if (!message) {
      return Response.json({ ok: false, error: "`message` 不能为空" }, { status: 400 });
    }

    const upstream = await aiwanwuFetch(
      "/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: body?.model?.trim() || AIWANWU_DEFAULT_TEXT_MODEL,
          stream: true,
          messages: [
            {
              role: "system",
              content:
                "你是一个自然的中文创作助手。你的任务只是顺滑地和用户对话，不要输出 JSON，不要暴露后台动作规划，不要解释系统结构。",
            },
            {
              role: "user",
              content: buildTextUserContent({ ...body, message }),
            },
          ],
        }),
      },
      body?.providerId === "foropencode" || body?.providerId === "default_gpt"
        ? body.providerId
        : undefined
    );

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      return Response.json(
        {
          ok: false,
          error: text.trim() || "聊天流请求失败",
        },
        { status: 500 }
      );
    }

    const encoder = new TextEncoder();
    const reader = upstream.body.getReader();
    let upstreamBuffer = "";
    let fullReply = "";
    let finalModel = body?.model?.trim() || AIWANWU_DEFAULT_TEXT_MODEL;

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "done",
                reply: fullReply.trim(),
                model: finalModel,
              }) + "\n"
            )
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
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as {
              model?: string;
              choices?: Array<{
                delta?: { content?: unknown };
              }>;
            };
            if (typeof parsed.model === "string" && parsed.model.trim()) {
              finalModel = parsed.model.trim();
            }
            const chunk = normalizeStreamDeltaContent(parsed.choices?.[0]?.delta?.content);
            if (!chunk) continue;
            fullReply += chunk;
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  event: "reply_delta",
                  chunk,
                }) + "\n"
              )
            );
          } catch {
            /* ignore */
          }
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "聊天流请求失败";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
