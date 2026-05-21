import path from "path";

export function isCloudDeployment() {
  return (
    process.env.CLOUD_DEPLOYMENT === "1" ||
    process.env.VERCEL === "1" ||
    process.env.NEXT_PUBLIC_DEPLOY_TARGET === "vercel"
  );
}

export function cloudGeneratedDir() {
  return path.join("/tmp", "wuxianhuabu-generated");
}

export function isRemoteMediaUrl(value: string | null | undefined) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^https?:\/\//i.test(text) || /^data:(image|video)\//i.test(text);
}

export function envText(...keys: Array<string | undefined>) {
  for (const key of keys) {
    if (!key) continue;
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function maskSecretForClient(value: string | undefined) {
  void value;
  return "";
}
