import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: {
    default: "StationSnap",
    template: "%s | StationSnap",
  },
  description: "Restaurant SOPs and training, ready where the work happens.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const themeScript = `(function(){try{var saved=localStorage.getItem('stationsnap-theme');var theme=saved==='light'||saved==='dark'?saved:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;}catch(e){document.documentElement.dataset.theme='dark';}})();`;
  return (
    <html lang="en" data-scroll-behavior="smooth" data-theme="dark" suppressHydrationWarning>
      <head>
        <Script id="stationsnap-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
