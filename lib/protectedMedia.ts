export type ProtectedMediaSourceInput = {
  sourceId: string;
  label?: string;
  kind?: "current" | "recent";
  paths: string[];
};

export async function syncProtectedMediaSources(_args: {
  sources: ProtectedMediaSourceInput[];
  replaceGroup?: string;
}) {
  return {
    ok: true as const,
    sources: 0,
    protectedPaths: 0,
  };
}

export async function removeProtectedMediaSource(_sourceId: string): Promise<void> {}

export async function getProtectedMediaRefs(_relPath: string) {
  return [] as Array<{ sourceId: string; label?: string; kind?: "current" | "recent" }>;
}

export async function isProtectedGeneratedRelPath(_relPath: string): Promise<boolean> {
  return false;
}
