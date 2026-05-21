import type { Metadata } from "next";
import "./globals.css";
import {
  APP_BRAND_DESCRIPTION,
  APP_BRAND_LOGO_SRC,
  APP_BRAND_TITLE,
} from "@/lib/brand";

export const metadata: Metadata = {
  title: APP_BRAND_TITLE,
  description: APP_BRAND_DESCRIPTION,
  icons: {
    icon: APP_BRAND_LOGO_SRC,
    shortcut: APP_BRAND_LOGO_SRC,
    apple: APP_BRAND_LOGO_SRC,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
