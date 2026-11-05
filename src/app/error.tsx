"use client";
import { ErrorScreen } from "@/components/error-screen";

/** Ошибка на любой странице: вместо «Application error» — понятное сообщение и обновление страницы */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} />;
}
