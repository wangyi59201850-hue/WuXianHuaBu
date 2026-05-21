import {
  type ExternalImageApiProviderId,
  isExternalImageApiProviderId,
} from "@/lib/externalImageApiShared";
import { envText, maskSecretForClient } from "@/lib/cloudDeployment";

export type { ExternalImageApiProviderId } from "@/lib/externalImageApiShared";

export type ExternalImageApiProviderConfig = {
  enabled?: boolean;
  displayName?: string;
  baseUrl: string;
  apiKey: string;
  imageModel: string;
  textModel: string;
  imageCostPerGeneration?: number;
  imageCostCurrency?: string;
};

export type ExternalImageApiConfig = {
  activeProviderId: ExternalImageApiProviderId;
  providers: Record<ExternalImageApiProviderId, ExternalImageApiProviderConfig>;
  baseUrl: string;
  apiKey: string;
  imageModel: string;
  textModel: string;
  imageCostPerGeneration?: number;
  imageCostCurrency?: string;
};

type ExternalImageApiProviderConfigInput = Partial<
  Omit<
    ExternalImageApiProviderConfig,
    "imageCostPerGeneration" | "imageCostCurrency"
  > & {
    imageCostPerGeneration?: number | string | null;
    imageCostCurrency?: string | null;
  }
>;

export type ExternalImageApiProviderMeta = {
  id: ExternalImageApiProviderId;
  label: string;
  description: string;
};

const PROVIDER_META: ExternalImageApiProviderMeta[] = [
  {
    id: "default_gpt",
    label: "默认 GPT",
    description: "通用 GPT 生图通道",
  },
  {
    id: "foropencode",
    label: "ForOpenCode",
    description: "ForOpenCode 生图通道",
  },
  {
    id: "google",
    label: "Google",
    description: "Google 生图通道",
  },
  {
    id: "banana2",
    label: "banana2",
    description: "banana2 异步生图通道",
  },
] as const;

const DEFAULT_ACTIVE_PROVIDER_ID: ExternalImageApiProviderId = "default_gpt";

const DEFAULT_PROVIDER_CONFIGS: Record<
  ExternalImageApiProviderId,
  ExternalImageApiProviderConfig
> = {
  default_gpt: {
    displayName: "默认 GPT",
    baseUrl: "",
    apiKey: "",
    imageModel: "gpt-image-2-c",
    textModel: "gpt-5.4",
  },
  foropencode: {
    displayName: "ForOpenCode",
    baseUrl: "",
    apiKey: "",
    imageModel: "gpt-draw-2048x2048",
    textModel: "gpt-5.4",
  },
  google: {
    displayName: "Google",
    baseUrl: "",
    apiKey: "",
    imageModel: "nano-banana-2",
    textModel: "gpt-5.4",
  },
  banana2: {
    displayName: "banana2",
    baseUrl: "",
    apiKey: "",
    imageModel: "banana2",
    textModel: "gpt-5.4",
  },
};

function normalizeBaseUrl(
  input: string,
  fallback: string,
  providerId: ExternalImageApiProviderId
) {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return fallback;
  if (providerId === "banana2") return trimmed;
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function hasOwn(input: object | null | undefined, key: string) {
  return !!input && Object.prototype.hasOwnProperty.call(input, key);
}

function normalizeOptionalCost(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function normalizeCurrency(value: unknown, fallback?: string) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

function sanitizeProviderConfig(
  input: ExternalImageApiProviderConfigInput | null | undefined,
  fallback: ExternalImageApiProviderConfig,
  providerId: ExternalImageApiProviderId
): ExternalImageApiProviderConfig {
  const requestedImageModel =
    typeof input?.imageModel === "string" && input.imageModel.trim()
      ? input.imageModel.trim()
      : fallback.imageModel;
  const requestedTextModel =
    typeof input?.textModel === "string" && input.textModel.trim()
      ? input.textModel.trim()
      : fallback.textModel;
  const safeTextModel =
    /image|draw|nano-banana|image-preview|banana2/i.test(requestedTextModel)
      ? fallback.textModel
      : requestedTextModel;
  const imageCostPerGeneration = hasOwn(input, "imageCostPerGeneration")
    ? normalizeOptionalCost(input?.imageCostPerGeneration)
    : fallback.imageCostPerGeneration;
  const imageCostCurrency = normalizeCurrency(
    hasOwn(input, "imageCostCurrency") ? input?.imageCostCurrency : undefined,
    fallback.imageCostCurrency
  );

  return {
    displayName:
      typeof input?.displayName === "string" && input.displayName.trim()
        ? input.displayName.trim()
        : fallback.displayName,
    baseUrl: normalizeBaseUrl(
      typeof input?.baseUrl === "string" ? input.baseUrl : fallback.baseUrl,
      fallback.baseUrl,
      providerId
    ),
    apiKey:
      typeof input?.apiKey === "string" && input.apiKey.trim()
        ? input.apiKey.trim()
        : fallback.apiKey,
    imageModel: requestedImageModel,
    textModel: safeTextModel,
    ...(imageCostPerGeneration !== undefined ? { imageCostPerGeneration } : {}),
    ...(imageCostCurrency ? { imageCostCurrency } : {}),
  };
}

function envPrefixForProvider(providerId: ExternalImageApiProviderId) {
  switch (providerId) {
    case "foropencode":
      return "FOROPENCODE";
    case "google":
      return "GOOGLE";
    case "banana2":
      return "BANANA2";
    default:
      return "DEFAULT_GPT";
  }
}

function readProviderConfigFromEnv(
  providerId: ExternalImageApiProviderId,
  isActiveProvider: boolean
) {
  const prefix = envPrefixForProvider(providerId);
  const fallback = DEFAULT_PROVIDER_CONFIGS[providerId];
  const sharedBaseUrl = isActiveProvider
    ? envText("EXTERNAL_IMAGE_BASE_URL", "AIWANWU_BASE_URL")
    : "";
  const sharedApiKey = isActiveProvider
    ? envText("EXTERNAL_IMAGE_API_KEY", "AIWANWU_API_KEY")
    : "";
  const sharedImageModel = isActiveProvider ? envText("EXTERNAL_IMAGE_IMAGE_MODEL") : "";
  const sharedTextModel = isActiveProvider ? envText("EXTERNAL_IMAGE_TEXT_MODEL") : "";
  const sharedDisplayName = isActiveProvider ? envText("EXTERNAL_IMAGE_DISPLAY_NAME") : "";
  const sharedCost = isActiveProvider ? envText("EXTERNAL_IMAGE_COST_PER_GENERATION") : "";
  const sharedCurrency = isActiveProvider ? envText("EXTERNAL_IMAGE_COST_CURRENCY") : "";

  return sanitizeProviderConfig(
    {
      displayName: envText(`EXTERNAL_IMAGE_${prefix}_DISPLAY_NAME`) || sharedDisplayName,
      baseUrl: envText(`EXTERNAL_IMAGE_${prefix}_BASE_URL`) || sharedBaseUrl,
      apiKey: envText(`EXTERNAL_IMAGE_${prefix}_API_KEY`) || sharedApiKey,
      imageModel:
        envText(`EXTERNAL_IMAGE_${prefix}_IMAGE_MODEL`) || sharedImageModel,
      textModel: envText(`EXTERNAL_IMAGE_${prefix}_TEXT_MODEL`) || sharedTextModel,
      imageCostPerGeneration:
        envText(`EXTERNAL_IMAGE_${prefix}_COST_PER_GENERATION`) || sharedCost,
      imageCostCurrency:
        envText(`EXTERNAL_IMAGE_${prefix}_COST_CURRENCY`) || sharedCurrency,
    },
    fallback,
    providerId
  );
}

function buildConfigFromEnv(): ExternalImageApiConfig {
  const activeProviderIdRaw = envText("EXTERNAL_IMAGE_ACTIVE_PROVIDER_ID");
  const activeProviderId = isExternalImageApiProviderId(activeProviderIdRaw)
    ? activeProviderIdRaw
    : DEFAULT_ACTIVE_PROVIDER_ID;

  const providers: Record<
    ExternalImageApiProviderId,
    ExternalImageApiProviderConfig
  > = {
    default_gpt: readProviderConfigFromEnv(
      "default_gpt",
      activeProviderId === "default_gpt"
    ),
    foropencode: readProviderConfigFromEnv(
      "foropencode",
      activeProviderId === "foropencode"
    ),
    google: readProviderConfigFromEnv("google", activeProviderId === "google"),
    banana2: readProviderConfigFromEnv(
      "banana2",
      activeProviderId === "banana2"
    ),
  };

  const activeProvider = providers[activeProviderId];
  return {
    activeProviderId,
    providers,
    baseUrl: activeProvider.baseUrl,
    apiKey: activeProvider.apiKey,
    imageModel: activeProvider.imageModel,
    textModel: activeProvider.textModel,
    ...(activeProvider.imageCostPerGeneration !== undefined
      ? { imageCostPerGeneration: activeProvider.imageCostPerGeneration }
      : {}),
    ...(activeProvider.imageCostCurrency
      ? { imageCostCurrency: activeProvider.imageCostCurrency }
      : {}),
  };
}

export async function readExternalImageApiConfig() {
  return buildConfigFromEnv();
}

export async function writeExternalImageApiConfig(
  _input: Partial<
    Omit<ExternalImageApiConfig, "imageCostPerGeneration" | "imageCostCurrency"> & {
      activeProviderId: ExternalImageApiProviderId;
      displayName?: string;
      imageCostPerGeneration?: number | string | null;
      imageCostCurrency?: string | null;
    }
  >
): Promise<ExternalImageApiConfig> {
  throw new Error("云端版不支持在浏览器内持久化图片 API 配置，请改用环境变量。");
}

export function getDefaultExternalImageApiConfig() {
  return buildConfigFromEnv();
}

export function getExternalImageApiProviderMetaList() {
  return [...PROVIDER_META];
}

export function sanitizeExternalImageApiConfigForClient(
  config: ExternalImageApiConfig
): ExternalImageApiConfig {
  const providers: Record<
    ExternalImageApiProviderId,
    ExternalImageApiProviderConfig
  > = {
    default_gpt: {
      ...config.providers.default_gpt,
      apiKey: maskSecretForClient(config.providers.default_gpt.apiKey),
    },
    foropencode: {
      ...config.providers.foropencode,
      apiKey: maskSecretForClient(config.providers.foropencode.apiKey),
    },
    google: {
      ...config.providers.google,
      apiKey: maskSecretForClient(config.providers.google.apiKey),
    },
    banana2: {
      ...config.providers.banana2,
      apiKey: maskSecretForClient(config.providers.banana2.apiKey),
    },
  };

  return {
    ...config,
    providers,
    apiKey: maskSecretForClient(config.apiKey),
  };
}
