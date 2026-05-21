import { readExternalImageApiConfig } from "@/lib/externalImageApiConfig";

type BalanceCandidate = {
  priority: number;
  depth: number;
  value: number;
  path: string;
  currency: string | null;
};

export type ExternalImageApiBalanceResult =
  | {
      ok: true;
      balance: number;
      balanceText: string;
      currency: string | null;
      sourceUrl: string;
      sourcePath: string;
    }
  | {
      ok: false;
      error: string;
    };

const BALANCE_KEYS = [
  "balance",
  "availablebalance",
  "available",
  "totalavailable",
  "availableamount",
  "remainingbalance",
  "remainingcredit",
  "remainingquota",
  "remaining",
  "remainquota",
  "remainamount",
  "remainbalance",
  "remain",
  "creditbalance",
  "quotabalance",
  "quota",
  "totalbalance",
  "amount",
] as const;

const CURRENCY_KEYS = [
  "currency",
  "currencycode",
  "currencytype",
  "unit",
  "balanceunit",
] as const;

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatBalance(value: number) {
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  }
  if (Number.isInteger(value)) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function findCurrencyOnObject(obj: Record<string, unknown>) {
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    if (!CURRENCY_KEYS.includes(normalizeKey(rawKey) as (typeof CURRENCY_KEYS)[number])) continue;
    const currency = parseCurrency(rawValue);
    if (currency) return currency;
  }
  return null;
}

function findBalanceInPayload(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const queue: Array<{
    value: unknown;
    path: string;
    depth: number;
    inheritedCurrency: string | null;
  }> = [{ value: input, path: "$", depth: 0, inheritedCurrency: null }];
  const seen = new Set<unknown>();
  let best: BalanceCandidate | null = null;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const { value, path, depth, inheritedCurrency } = current;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        queue.push({
          value: item,
          path: `${path}[${index}]`,
          depth: depth + 1,
          inheritedCurrency,
        });
      });
      continue;
    }

    const obj = value as Record<string, unknown>;
    const localCurrency = findCurrencyOnObject(obj) ?? inheritedCurrency;

    for (const [rawKey, rawValue] of Object.entries(obj)) {
      const normalizedKey = normalizeKey(rawKey);
      const priority = BALANCE_KEYS.indexOf(normalizedKey as (typeof BALANCE_KEYS)[number]);
      if (priority >= 0) {
        const numeric = parseNumeric(rawValue);
        if (numeric !== null) {
          const candidate: BalanceCandidate = {
            priority,
            depth,
            value: numeric,
            path: `${path}.${rawKey}`,
            currency: localCurrency,
          };
          if (
            !best ||
            candidate.priority < best.priority ||
            (candidate.priority === best.priority && candidate.depth < best.depth)
          ) {
            best = candidate;
          }
        }
      }
    }

    for (const [rawKey, rawValue] of Object.entries(obj)) {
      if (!rawValue || typeof rawValue !== "object") continue;
      queue.push({
        value: rawValue,
        path: `${path}.${rawKey}`,
        depth: depth + 1,
        inheritedCurrency: localCurrency,
      });
    }
  }

  return best;
}

async function readJsonOrText(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const numeric = parseNumeric(text);
    if (numeric !== null) {
      return { balance: numeric };
    }
    return null;
  }
}

function buildCandidateUrls(baseUrl: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const rootBase = normalizedBase.replace(/\/v1$/i, "");
  const suffixes = [
    "/balance",
    "/user/balance",
    "/account/balance",
    "/billing/balance",
    "/dashboard/billing/subscription",
    "/dashboard/billing/credit_grants",
  ];
  const urls = new Set<string>();

  for (const base of [normalizedBase, rootBase]) {
    if (!base) continue;
    for (const suffix of suffixes) {
      urls.add(`${base}${suffix}`);
    }
  }

  return [...urls];
}

export async function queryExternalImageApiBalance(): Promise<ExternalImageApiBalanceResult> {
  const config = await readExternalImageApiConfig();
  const baseUrl = config.baseUrl?.trim();
  const apiKey = config.apiKey?.trim();

  if (!baseUrl) {
    return { ok: false, error: "External image API base URL is not configured" };
  }
  if (!apiKey) {
    return { ok: false, error: "External image API key is not configured" };
  }

  let lastError = "No supported balance endpoint responded";

  for (const url of buildCandidateUrls(baseUrl)) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        lastError = `Balance request failed (${response.status})`;
        continue;
      }

      const payload = await readJsonOrText(response);
      const balance = findBalanceInPayload(payload);
      if (!balance) {
        lastError = "Upstream responded but no balance field was detected";
        continue;
      }

      return {
        ok: true,
        balance: balance.value,
        balanceText: formatBalance(balance.value),
        currency: balance.currency,
        sourceUrl: url,
        sourcePath: balance.path,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { ok: false, error: lastError };
}
