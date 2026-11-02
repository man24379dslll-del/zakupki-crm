import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: { default: "CRM закупок", template: "%s · CRM закупок" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
