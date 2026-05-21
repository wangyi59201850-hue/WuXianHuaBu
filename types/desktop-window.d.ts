type DesktopWindowState = {
  isMaximized: boolean;
};

type DesktopDownloadAsset = {
  url: string;
  fileName?: string | null;
  suggestedName?: string | null;
  mediaType?: "image" | "video" | "file";
};

type DesktopBatchDownloadResult = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  downloadDir?: string;
  savedCount?: number;
  failedCount?: number;
  saved?: Array<{
    url: string;
    fileName: string;
    savedPath: string;
  }>;
  failed?: Array<{
    index: number;
    name?: string | null;
    error: string;
  }>;
};

type DesktopWindowApi = {
  isDesktop: boolean;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  batchDownloadAssets: (items: DesktopDownloadAsset[]) => Promise<DesktopBatchDownloadResult>;
  onStateChange: (callback: (state: DesktopWindowState) => void) => () => void;
};

declare global {
  interface Window {
    desktopWindow?: DesktopWindowApi;
  }
}

export {};
