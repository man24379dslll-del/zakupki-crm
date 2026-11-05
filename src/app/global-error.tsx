"use client";
import "./globals.css";
import { ErrorScreen } from "@/components/error-screen";

/** Ошибка в самом корневом макете — своя страница с html/body */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-slate-50 font-sans">
        <ErrorScreen error={error} />
      </body>
    </html>
  );
}
