import { getVideoModelCatalog } from "@/lib/cliVideoModels";
import {
  readExternalVideoApiConfig,
  type ExternalVideoApiConfig,
} from "@/lib/externalVideoApiConfig";

const VIDEO_MODEL_FALLBACKS = getVideoModelCatalog()
  .filter((item) => item.provider === "foropencode")
  .map((item) => item.value);

function summarizeUpstreamBody(text: string, limit = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

export async function readExternalVideoApiConfigOrThrow() {
  const config = await readExternalVideoApiConfig();
  if (!config.baseUrl.trim()) {
    throw new Error("外部生视频 API 地址未配置。");
  }
  if (!config.apiKey.trim()) {
    throw new Error("外部生视频 API 密钥未配置。");
  }
  return config;
}

export async function externalVideoFetch(
  pathname: string,
  init?: RequestInit,
  configOverride?: ExternalVideoApiConfig
) {
  const config = configOverride ?? (await readExternalVideoApiConfigOrThrow());
  const resp = await fetch(`${config.baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  return resp;
}

export function getFallbackExternalVideoModels() {
  return [...VIDEO_MODEL_FALLBACKS];
}

export async function fetchExternalVideoModels(configOverride?: ExternalVideoApiConfig) {
  const resp = await externalVideoFetch("/models", undefined, configOverride);
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    throw new Error(
      text.trim() ? summarizeUpstreamBody(text) : `外部生视频模型列表请求失败：${resp.status}`
    );
  }
  if (!text.trim()) return getFallbackExternalVideoModels();
  let json: {
    data?: Array<{
      id?: string;
    }>;
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(`外部生视频模型列表返回了非 JSON：${summarizeUpstreamBody(text)}`);
  }
  const models = (json.data ?? [])
    .map((item) => item.id?.trim())
    .filter((id): id is string => Boolean(id));
  return models.length > 0 ? models : getFallbackExternalVideoModels();
}
