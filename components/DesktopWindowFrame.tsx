"use client";

import Image from "next/image";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { APP_BRAND_LOGO_SRC, APP_BRAND_TITLE } from "@/lib/brand";

function FrameButton(props: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const { title, onClick, disabled = false, danger = false, children } = props;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        "flex h-9 w-11 items-center justify-center transition-colors",
        disabled
          ? "cursor-default text-zinc-700"
          : danger
            ? "text-zinc-500 hover:bg-red-700 hover:text-white"
            : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200",
      ].join(" ")}
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      {children}
    </button>
  );
}

export function DesktopWindowFrame() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const api = window.desktopWindow;
    if (!api?.isDesktop) return;

    setIsDesktop(true);
    void api.isMaximized().then(setIsMaximized).catch(() => {});

    const unsubscribe = api.onStateChange((state) => {
      setIsMaximized(Boolean(state?.isMaximized));
    });

    return unsubscribe;
  }, []);

  return (
    <div
      className="flex h-9 shrink-0 items-center justify-between border-b border-white/5 bg-[#0d0e10] text-zinc-300 select-none"
      style={{ WebkitAppRegion: isDesktop ? "drag" : "no-drag" } as CSSProperties}
      onDoubleClick={() => {
        if (!isDesktop) return;
        void window.desktopWindow?.toggleMaximize();
      }}
    >
      <div className="flex min-w-0 items-center gap-2 px-3">
        <div className="overflow-hidden rounded-[7px]">
          <Image
            src={APP_BRAND_LOGO_SRC}
            alt={APP_BRAND_TITLE}
            width={20}
            height={20}
            className="h-5 w-5 object-cover"
            priority
          />
        </div>
        <div className="truncate text-[11px] font-medium tracking-[0.02em] text-zinc-200">
          {APP_BRAND_TITLE}
        </div>
      </div>
      <div className="flex items-center">
        <FrameButton
          title="最小化"
          disabled={!isDesktop}
          onClick={() => void window.desktopWindow?.minimize()}
        >
          <Minus className="h-3.5 w-3.5" />
        </FrameButton>
        <FrameButton
          title={isMaximized ? "还原" : "最大化"}
          disabled={!isDesktop}
          onClick={() => void window.desktopWindow?.toggleMaximize()}
        >
          <Square className="h-2.5 w-2.5" />
        </FrameButton>
        <FrameButton
          title="关闭"
          danger
          disabled={!isDesktop}
          onClick={() => void window.desktopWindow?.close()}
        >
          <X className="h-3.5 w-3.5" />
        </FrameButton>
      </div>
    </div>
  );
}
