import fs from "fs/promises";
import path from "path";

/**
 * dreamina 下载到 download_dir 时往往带随机/默认文件名；我们再 copy 成 {nodeId}_{i}.ext。
 * 若不去掉源文件，outputs/generated 里会留两份相同内容的文件。
 */
export async function unlinkCliArtifactAfterCopy(params: {
  outDirAbs: string;
  downloadedPath: string;
  finalPath: string;
}): Promise<void> {
  const from = path.resolve(params.downloadedPath);
  const to = path.resolve(params.finalPath);
  if (from === to) return;
  const root = path.resolve(params.outDirAbs);
  const rel = path.relative(root, from);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return;
  try {
    await fs.unlink(from);
  } catch {
    /* ENOENT / busy */
  }
}
