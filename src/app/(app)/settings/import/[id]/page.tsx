import { requirePerm } from "@/lib/auth";
import { PERMS } from "@/lib/permissions";
import { loadImport } from "@/lib/import/load";
import { buildPreview } from "@/lib/import/importer";
import { colLetter, type ColumnMapping } from "@/lib/import/parser";
import { normKey } from "@/lib/normalize";
import { selectOptions } from "@/lib/services/refs";
import { fmtDate, fmtMoney, fmtQty, ORDER_STATUS_LABEL } from "@/lib/format";
import { Alert, Badge, Card, cn, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { runImportAction, saveImportSettingsAction } from "../../actions";

export const metadata = { title: "Импорт Excel" };

const FIELD_LABELS: Partial<Record<keyof ColumnMapping, string>> = {
  direction: "Направление",
  legalEntity: "Наше юрлицо",
  supplier: "Контрагент",
  product: "Наименование",
  orderDate: "Дата заказа",
  invoice: "Счёт №",
  qty: "Кол-во",
  price: "Цена закупки",
  deliveryFrom: "Поставки: первый столбец",
  deliveryTo: "Поставки: последний столбец",
  paymentDoc: "№ ПП",
  paymentDate: "Дата оплаты",
  paymentAmount: "Сумма оплаты",
  remainder: "Остаток неотгруженный",
  note: "Примечание",
  invoiceDate: "Дата счёта",
  amount: "Сумма заказа",
  advanceDate: "Дата аванса",
  advanceAmount: "Сумма аванса",
  shipDate: "Дата поставки",
  shipAmount: "Сумма отгрузки",
  shipQty: "Кол-во поставки",
  finalDate: "Дата полного расчёта",
  finalAmount: "Сумма полного расчёта",
  dateFrom: "Недели: первый столбец",
  dateTo: "Недели: последний столбец",
};
const KIND: Record<string, string> = { main: "Основной (поставки по столбцам)", simple: "Строка = счёт", plan: "План поставок", unknown: "Не распознан" };
const LEVEL: Record<string, { tone: string; label: string }> = { error: { tone: "red", label: "Ошибка" }, warning: { tone: "amber", label: "Внимание" }, info: { tone: "blue", label: "Инфо" } };

export default async function ImportPreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePerm(PERMS.importRun);
  let loaded;
  try {
    loaded = await loadImport(id);
  } catch (e) {
    return <Alert tone="amber">{(e as Error).message}</Alert>;
  }
  const { batch, stored, parsed } = loaded;
  const pv = await buildPreview(parsed, stored.settings);
  const opts = await selectOptions();
  const done = batch.status !== "preview";
  const hex = (s: string) => Buffer.from(s).toString("hex");
  const issuesByCode = new Map<string, typeof pv.issues>();
  for (const i of pv.issues) {
    const k = `${i.level}|${i.code}`;
    if (!issuesByCode.has(k)) issuesByCode.set(k, []);
    issuesByCode.get(k)!.push(i);
  }
  const order = { error: 0, warning: 1, info: 2 };
  const groups = [...issuesByCode].sort((a, b) => order[a[0].split("|")[0] as "error"] - order[b[0].split("|")[0] as "error"]);

  return (
    <>
      <PageHeader title={`Импорт «${batch.fileName}»`} back={{ href: "/settings?tab=import", label: "Импорт" }} subtitle={done ? `Статус: ${batch.status === "done" ? "выполнен" : batch.status}` : "Шаг 1 — проверьте распознавание и настройки. Шаг 2 — подтвердите импорт внизу страницы."} />
      {done && <div className="mb-4"><Alert tone="green">Импорт уже выполнен. Ниже — состояние на момент выполнения; повторный импорт этого файла пропустит уже загруженные заказы.</Alert></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Поставщиков" value={pv.counts.suppliers} sub={`новых ${pv.counts.newSuppliers}`} />
        <Stat label="Товаров" value={pv.counts.products} sub={`новых ${pv.counts.newProducts}`} />
        <Stat label="Наших юрлиц" value={pv.counts.legal} />
        <Stat label="Заказов (счетов)" value={pv.counts.orders} sub={pv.counts.duplicatesInDb ? `уже в базе: ${pv.counts.duplicatesInDb}` : undefined} />
        <Stat label="Позиций" value={pv.counts.items} />
        <Stat label="Фактич. поставок" value={pv.counts.deliveries} sub="по позициям" />
        <Stat label="Оплат" value={pv.counts.payments} />
        <Stat label="Строк плана" value={pv.counts.plan} />
      </div>

      <ActionForm action={saveImportSettingsAction} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Card title="1. Распознанные листы и сверка с итогами Excel" pad={false}>
          <Table>
            <thead><tr><Th>Импорт</Th><Th>Лист</Th><Th>Формат</Th><Th right>Заказов</Th><Th right>Позиций</Th><Th right>Сумма: система / Excel</Th><Th right>Поставлено, шт: система / Excel</Th><Th right>Оплачено: система / Excel</Th><Th>Закупщик</Th><Th>Поставщик (если нет в листе)</Th></tr></thead>
            <tbody>
              {pv.sheets.map((s) => {
                const k = hex(s.name);
                const cmp = (a: number, b?: number, money = true) => {
                  const ok = b === undefined || Math.abs(a - b) < 1;
                  return (
                    <span className={cn(!ok && "font-medium text-amber-700")}>
                      {money ? fmtMoney(a) : fmtQty(a)}
                      <span className="text-slate-400"> / {b === undefined ? "—" : money ? fmtMoney(b) : fmtQty(b)}</span>
                      {!ok && " ⚠"}
                    </span>
                  );
                };
                const st = stored.settings.sheets[s.name];
                return (
                  <tr key={s.name}>
                    <Td><input type="checkbox" name={`en_${k}`} defaultChecked={st?.enabled} disabled={done} /></Td>
                    <Td className="font-medium">{s.name}{s.duplicateOf && <div><Badge tone="amber">копия «{s.duplicateOf}»</Badge></div>}</Td>
                    <Td className="text-xs">{KIND[s.kind]}</Td>
                    <Td right>{s.orders}</Td>
                    <Td right>{s.plan ? `${s.plan} (план)` : s.items}</Td>
                    <Td right className="text-xs">{s.kind === "plan" ? "—" : cmp(s.totals.amount, s.excel?.amount)}</Td>
                    <Td right className="text-xs">{s.kind === "plan" ? "—" : cmp(s.totals.delivered, s.excel?.delivered, false)}</Td>
                    <Td right className="text-xs">{s.kind === "plan" ? "—" : cmp(s.totals.paid, s.excel?.paid)}{s.supplierPayments > 0 && <div className="text-slate-500">+ {s.supplierPayments} авансов без счёта</div>}</Td>
                    <Td>
                      <select name={`buyer_${k}`} defaultValue={st?.buyerId ?? ""} disabled={done} className="rounded border border-slate-300 px-1 py-1 text-xs">
                        <option value="">не назначать</option>
                        {opts.buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </Td>
                    <Td><input name={`sup_${k}`} defaultValue={st?.supplierName ?? ""} disabled={done} placeholder="—" className="w-36 rounded border border-slate-300 px-2 py-1 text-xs" /></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="px-4 py-2 text-xs text-slate-500">⚠ — расхождение с итоговой строкой Excel. Для «ООО Бьютирин» это ожидаемо: формула «ИТОГО» в файле охватывает не все столбцы поставок.</p>
        </Card>

        <Card title="2. Сопоставление столбцов (буква столбца Excel)">
          <p className="mb-3 text-xs text-slate-500">Столбцы найдены по заголовкам автоматически. Если заголовок в файле назван иначе — впишите букву и нажмите «Применить».</p>
          <div className="space-y-3">
            {parsed.sheets.filter((s) => s.kind !== "unknown").map((s) => {
              const k = hex(s.name);
              return (
                <details key={s.name} className="rounded-lg border border-slate-200">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{s.name} <span className="text-xs font-normal text-slate-500">· строка заголовков {s.headerRow}{s.kind === "main" && ` · даты поставок: ${s.deliveryDates.filter((d) => d.date).length} столбцов (${s.deliveryDates.find((d) => d.date)?.letter}–${s.deliveryDates.filter((d) => d.date).at(-1)?.letter})`}</span></summary>
                  <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-6">
                    <label className="text-xs text-slate-500">Строка заголовков<input name={`hr_${k}`} defaultValue={String(s.headerRow)} disabled={done} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" /></label>
                    {Object.entries(s.mapping).filter(([f]) => FIELD_LABELS[f as keyof ColumnMapping]).map(([f, c]) => (
                      <label key={f} className="text-xs text-slate-500">
                        {FIELD_LABELS[f as keyof ColumnMapping]}
                        <input name={`map_${k}_${f}`} defaultValue={c ? colLetter(c as number) : ""} disabled={done} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm uppercase" />
                      </label>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </Card>

        <Card title="3. Похожие названия — объединить при импорте">
          {pv.merges.length === 0 ? <p className="text-sm text-slate-500">Похожих названий не найдено. Названия, отличающиеся только регистром, кавычками и пробелами, объединяются автоматически.</p> : (
            <div className="space-y-1">
              {pv.merges.map((m) => (
                <label key={m.kind + m.from} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="merge" value={JSON.stringify([normKey(m.from), m.to])} defaultChecked={!!stored.settings.merges[normKey(m.from)]} disabled={done} className="mt-1" />
                  <span><Badge>{{ legal: "юрлицо", supplier: "поставщик", product: "товар" }[m.kind]}</Badge> «{m.from}» ({m.fromCount}) → «{m.to}» ({m.toCount})</span>
                </label>
              ))}
            </div>
          )}
        </Card>

        <Card title="4. Правила (решения по неоднозначностям)">
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">Плановая дата поставки = дата заказа + <input name="leadDays" type="number" defaultValue={stored.settings.leadDays} disabled={done} className="w-20 rounded border border-slate-300 px-2 py-1" /> дней (в Excel плановых дат нет)</label>
            <label className="flex items-start gap-2"><input type="checkbox" name="closeManual" defaultChecked={stored.settings.closeManual} disabled={done} className="mt-1" /> Позиции, где «остаток неотгруженный» в Excel перезаписан вручную, считать закрытыми (недопоставка больше не ожидается)</label>
            <label className="flex items-start gap-2"><input type="checkbox" name="supplierAdvances" defaultChecked={stored.settings.supplierAdvances} disabled={done} className="mt-1" /> Импортировать платежи без счёта как авансы поставщику</label>
            <label className="flex items-start gap-2"><input type="checkbox" name="assumeSimpleDeliveries" defaultChecked={stored.settings.assumeSimpleDeliveries} disabled={done} className="mt-1" /> «ост.поставщики»: при отсутствии даты поставки создавать поставку на дату счёта (с пометкой «дата условная», вне средних цен при неизвестном количестве)</label>
            <p className="text-xs text-slate-500">Поставки сверх заказа из Excel переносятся как есть и помечаются «превышение подтверждено». Цена поставки = цена заказа (в Excel фактической цены нет).</p>
          </div>
        </Card>
        {!done && <SubmitButton variant="secondary">Применить и пересчитать предпросмотр</SubmitButton>}
      </ActionForm>

      <Card title={`5. Ошибки и предупреждения (${pv.issues.length})`} className="my-4">
        <div className="space-y-2">
          {groups.map(([key, list]) => {
            const [level] = key.split("|");
            return (
              <details key={key} className="rounded-lg border border-slate-200" open={level === "error"}>
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  <Badge tone={LEVEL[level].tone}>{LEVEL[level].label}</Badge> <span className="ml-1">{list[0].message.length > 140 ? list[0].message.slice(0, 140) + "…" : list[0].message}</span> {list.length > 1 && <b className="text-slate-500">и ещё {list.length - 1}</b>}
                </summary>
                <ul className="max-h-64 space-y-1 overflow-y-auto border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
                  {list.map((i, n) => <li key={n}><b>{i.sheet}{i.row ? `, стр. ${i.row}` : ""}{i.cell ? ` (${i.cell})` : ""}:</b> {i.message}</li>)}
                </ul>
              </details>
            );
          })}
        </div>
      </Card>

      <Card title={`6. Предварительный результат: заказы (${pv.orders.length})`} pad={false} className="mb-4">
        <div className="max-h-[480px] overflow-y-auto">
          <Table>
            <thead><tr><Th>Лист, строки</Th><Th>Поставщик</Th><Th>Счёт</Th><Th>Дата</Th><Th right>Поз.</Th><Th right>Сумма</Th><Th right>Заказано / поставлено</Th><Th right>Оплачено</Th><Th>Будущий статус</Th></tr></thead>
            <tbody>
              {pv.orders.map((o) => (
                <tr key={o.fp + o.rows} className={o.duplicateInDb ? "opacity-50" : ""}>
                  <Td className="text-xs">{o.sheet}, {o.rows}</Td>
                  <Td className="max-w-48 truncate">{o.supplier}</Td>
                  <Td>{o.invoice ?? "—"}</Td>
                  <Td>{fmtDate(o.orderDate)}</Td>
                  <Td right>{o.items}</Td>
                  <Td right>{fmtMoney(o.amount)}</Td>
                  <Td right>{fmtQty(o.qty)} / {fmtQty(o.delivered)}</Td>
                  <Td right>{fmtMoney(o.paid)}</Td>
                  <Td>{o.duplicateInDb ? <Badge tone="gray">уже в базе — пропуск</Badge> : <Badge>{ORDER_STATUS_LABEL[o.status]}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      {!done && (
        <Card title="Подтверждение">
          <ActionForm action={runImportAction} className="space-y-3">
            <input type="hidden" name="id" value={id} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="agree" required /> Я проверил(а) предпросмотр. Импорт создаст {pv.counts.orders} заказов в одной транзакции, его можно откатить.</label>
            <SubmitButton>Импортировать</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
