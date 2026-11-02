import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Хранилище файлов документов.
 * - Если заданы SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY — Supabase Storage (приватный бакет SUPABASE_BUCKET, по умолчанию «documents»).
 *   Нужно для Railway: диск контейнера очищается при каждом деплое.
 * - Иначе — локальная папка UPLOAD_DIR (для разработки и своего сервера).
 * Доступ к файлам — только через /api/documents/[id] с проверкой прав; публичных ссылок нет.
 */
const SB_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET ?? "documents";
export const storageKind = SB_URL && SB_KEY ? "supabase" : "local";

const headers = () => ({ Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY! });

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const r = await fetch(`${SB_URL}/storage/v1/bucket/${BUCKET}`, { headers: headers() });
  if (r.status === 404 || r.status === 400) {
    const c = await fetch(`${SB_URL}/storage/v1/bucket`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
    if (!c.ok && c.status !== 409) throw new Error(`Supabase: не удалось создать бакет (${c.status} ${await c.text()})`);
  }
  bucketReady = true;
}

/** Сохраняет файл, возвращает ключ хранения (supabase:… или локальный путь) */
export async function putFile(key: string, data: Buffer, contentType: string): Promise<string> {
  if (storageKind === "supabase") {
    await ensureBucket();
    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${encodeURI(key)}`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": contentType || "application/octet-stream", "x-upsert": "false" },
      body: new Uint8Array(data),
    });
    if (!r.ok) throw new Error(`Supabase Storage: ошибка загрузки (${r.status} ${await r.text()})`);
    return `supabase:${key}`;
  }
  const full = path.resolve(process.env.UPLOAD_DIR ?? "./storage/uploads", key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return full;
}

export async function getFile(stored: string): Promise<Buffer> {
  if (stored.startsWith("supabase:")) {
    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${encodeURI(stored.slice(9))}`, { headers: headers() });
    if (!r.ok) throw new Error(`Supabase Storage: файл недоступен (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  return readFile(stored);
}
