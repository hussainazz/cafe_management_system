import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "سفارش | سامانه فروش کافه ران",
  description: "فضای مشترک سفارش‌گیری پرسنل و مدیران کافه ران.",
  applicationName: "Run Cafe POS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: "#f4efe7",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("pos-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme:dark)").matches)){document.documentElement.setAttribute("data-theme","dark")} }catch(e){}})()` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
