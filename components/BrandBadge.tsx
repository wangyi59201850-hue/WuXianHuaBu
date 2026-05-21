import Image from "next/image";
import {
  APP_BRAND_CAPTION,
  APP_BRAND_LOGO_SRC,
  APP_BRAND_TITLE,
} from "@/lib/brand";

type BrandBadgeProps = {
  className?: string;
  compact?: boolean;
};

export function BrandBadge({ className = "", compact = false }: BrandBadgeProps) {
  return (
    <div
      className={[
        "flex items-center gap-3 rounded-[20px] border border-white/10 bg-zinc-950/82 text-left backdrop-blur-xl",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
        className,
      ].join(" ")}
    >
      <div
        className={[
          "overflow-hidden rounded-[14px] ring-1 ring-white/10",
          compact ? "h-8 w-8" : "h-10 w-10",
        ].join(" ")}
      >
        <Image
          src={APP_BRAND_LOGO_SRC}
          alt={APP_BRAND_TITLE}
          width={compact ? 32 : 40}
          height={compact ? 32 : 40}
          className="h-full w-full object-cover"
          priority
        />
      </div>
      <div className="min-w-0">
        <div
          className={[
            "truncate font-semibold leading-tight text-white",
            compact ? "max-w-[180px] text-[12px]" : "max-w-[240px] text-[15px]",
          ].join(" ")}
        >
          {APP_BRAND_TITLE}
        </div>
        <div
          className={compact ? "mt-0.5 text-[9px] text-zinc-500" : "mt-0.5 text-[10px] text-zinc-500"}
        >
          {APP_BRAND_CAPTION}
        </div>
      </div>
    </div>
  );
}
