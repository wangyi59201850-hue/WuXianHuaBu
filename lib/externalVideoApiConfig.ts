import { envText, maskSecretForClient } from "@/lib/cloudDeployment";

export type ExternalVideoApiConfig = {
  displayName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

const DEFAULT_CONFIG: ExternalVideoApiConfig = {
  displayName: "视频 API",
  baseUrl: "",
  apiKey: "",
  model: "grok-imagine-video",
};

function normalizeBaseUrl(input: string, fallback: string) {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return fallback;
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function sanitizeConfig(
  input: Partial<ExternalVideoApiConfig> | null | undefined
): ExternalVideoApiConfig {
  return {
    displayName:
      typeof input?.displayName === "string" && input.displayName.trim()
        ? input.displayName.trim()
        : DEFAULT_CONFIG.displayName,
    baseUrl: normalizeBaseUrl(
      typeof input?.baseUrl === "string" ? input.baseUrl : DEFAULT_CONFIG.baseUrl,
      DEFAULT_CONFIG.baseUrl
    ),
    apiKey:
      typeof input?.apiKey === "string" && input.apiKey.trim()
        ? input.apiKey.trim()
        : DEFAULT_CONFIG.apiKey,
    model:
      typeof input?.model === "string" && input.model.trim()
        ? input.model.trim()
        : DEFAULT_CONFIG.model,
  };
}

function buildConfigFromEnv() {
  return sanitizeConfig({
    displayName: envText("EXTERNAL_VIDEO_DISPLAY_NAME"),
    baseUrl: envText("EXTERNAL_VIDEO_BASE_URL"),
    apiKey: envText("EXTERNAL_VIDEO_API_KEY"),
    model: envText("EXTERNAL_VIDEO_MODEL"),
  });
}

export async function readExternalVideoApiConfig() {
  return buildConfigFromEnv();
}

export async function writeExternalVideoApiConfig(
  _input: Partial<ExternalVideoApiConfig>
): Promise<ExternalVideoApiConfig> {
  throw new Error("云端版不支持在浏览器内持久化视频 API 配置，请改用环境变量。");
}

export function getDefaultExternalVideoApiConfig() {
  return buildConfigFromEnv();
}

export function sanitizeExternalVideoApiConfigForClient(
  config: ExternalVideoApiConfig
) {
  return {
    ...config,
    apiKey: maskSecretForClient(config.apiKey),
  };
}
