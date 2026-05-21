export type ExternalImageTaskCostSource = "configured" | "exact";

export type ExternalImageTaskCostResult = {
  amount: number;
  currency: string;
  source: ExternalImageTaskCostSource;
  perImage: number;
};

function normalizeConfiguredCost(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function normalizeCurrency(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "$";
}

export function formatTaskMoney(amount: number, currency = "$") {
  if (!Number.isFinite(amount)) return "";
  const prefix = currency === "$" ? "$" : `${currency} `;
  return `${prefix}${amount.toFixed(6)}`;
}

export function resolveConfiguredExternalImageTaskCost(input: {
  perGenerationCost?: number | null;
  currency?: string | null;
  count?: number | null;
}): ExternalImageTaskCostResult | null {
  const perImage = normalizeConfiguredCost(input.perGenerationCost);
  if (perImage === null) return null;
  const count =
    typeof input.count === "number" && Number.isFinite(input.count) && input.count > 0
      ? input.count
      : 1;
  return {
    amount: perImage * count,
    currency: normalizeCurrency(input.currency),
    source: "configured",
    perImage,
  };
}
