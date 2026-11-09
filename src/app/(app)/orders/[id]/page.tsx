import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser, AccessError } from "@/lib/auth";
import { can, PERMS } from "@/lib/permissions";
import { assertOrderAccess, ITEM_STATS } from "@/lib/services/orders";
import { opt, selectOptions } from "@/lib/services/refs";
import { fmtDate, fmtDateTime, fmtMoney, fmtPct, fmtPrice, fmtQty, num, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, orderNo, ORDER_PAY_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, TASK_STATUS_LABEL, today } from "@/lib/format";
import { Alert, Badge, Card, Field, Input, PageHeader, Progress, Select, Stat, Table, Td, Textarea, Th, cn } from "@/components/ui";
import { ActionForm, ConfirmButton, OrderPayFields, SubmitButton } from "@/components/client";
import { Combobox } from "@/components/combobox";
import { CommentsBlock, DocumentsBlock, HistoryBlock } from "@/components/blocks";
import {
  addItemAction,
  deleteDeliveryAction,
  deleteItemAction,
  deleteOrderAction,
  deletePaymentAction,
  registerDeliveryAction,
  registerPaymentAction,
  setOrderStatusAction,
  updateItemAction,
  updateOrderHeaderAction,
} from "../actions";

export const metadata = { title: "Заказ" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const { edit } = await searchParams;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let o;
  try {
    o = await assertOrderAccess(u, id);
  } catch (e) {
    if (e instanceof AccessError) return <Alert tone="red">{e.message}</Alert>;
    throw e;
  }
  const canEdit = can(u, PERMS.ordersEdit) && (can(u, PERMS.ordersViewAll) || o.buyerId === u.id);

  const [itemsRes, delivs, pays, supplier, buyer, legal, dir, opts] = await Promise.all([
    db.execute(sql`WITH ${ITEM_STATS}
      SELECT poi.id, poi.qty, poi.price, poi.is_closed, poi.closed_note, poi.over_delivery_approved, poi.note, pr.name AS product, pr.id AS product_id, pr.unit,
        poi.planned_delivery_date::text AS item_due, s.due_date::text AS due_date,
        d.name AS direction, s.delivered, s.delivered_amount
      FROM purchase_order_items poi JOIN products pr ON pr.id = poi.product_id
      LEFT JOIN directions d ON d.id = poi.direction_id
      JOIN item_stats s ON s.id = poi.id
      WHERE poi.order_id = ${id} ORDER BY poi.sort_order, pr.name`),
    db
      .select({ d: schema.deliveries, who: schema.users.name })
      .from(schema.deliveries)
      .leftJoin(schema.users, eq(schema.users.id, schema.deliveries.createdById))
      .where(and(eq(schema.deliveries.orderId, id), isNull(schema.deliveries.deletedAt)))
      .orderBy(desc(schema.deliveries.date)),
    db
      .select({ p: schema.payments, who: schema.users.name })
      .from(schema.payments)
      .leftJoin(schema.users, eq(schema.users.id, schema.payments.createdById))
      .where(and(eq(schema.payments.orderId, id), isNull(schema.payments.deletedAt)))
      .orderBy(asc(schema.payments.date)),
    db.select().from(schema.suppliers).where(eq(schema.suppliers.id, o.supplierId)).then((r) => r[0]),
    o.buyerId ? db.select().from(schema.users).where(eq(schema.users.id, o.buyerId)).then((r) => r[0]) : null,
    o.legalEntityId ? db.select().from(schema.legalEntities).where(eq(schema.legalEntities.id, o.legalEntityId)).then((r) => r[0]) : null,
    o.directionId ? db.select().from(schema.directions).where(eq(schema.directions.id, o.directionId)).then((r) => r[0]) : null,
    canEdit ? selectOptions({ inactive: [o.legalEntityId, o.directionId] }) : null,
  ]);
  const items = itemsRes.rows as {
    id: string; qty: string; price: string | null; is_closed: boolean; closed_note: string | null; over_delivery_approved: boolean; note: string | null;
    product: string; product_id: string; unit: string; direction: string | null; delivered: string; delivered_amount: string; item_due: string | null; due_date: string | null;
  }[];
  const dItems = delivs.length
    ? await db
        .select({ di: schema.deliveryItems, product: schema.products.name })
        .from(schema.deliveryItems)
        .innerJoin(schema.products, eq(schema.products.id, schema.deliveryItems.productId))
        .where(sql`${schema.deliveryItems.deliveryId} IN (${sql.join(delivs.map((d) => sql`${d.d.id}`), sql`, `)})`)
    : [];

  const amount = items.reduce((s, i) => s + Number(i.qty) * (num(i.price) ?? 0), 0);
  const qty = items.reduce((s, i) => s + Number(i.qty), 0);
  const delivered = items.reduce((s, i) => s + Number(i.delivered), 0);
  const deliveredAmount = items.reduce((s, i) => s + Number(i.delivered_amount), 0);
  const remaining = items.reduce((s, i) => s + (i.is_closed ? 0 : Math.max(Number(i.qty) - Number(i.delivered), 0)), 0);
  const paid = pays.reduce((s, p) => s + Number(p.p.amount), 0);
  const paidCash = pays.filter((p) => p.p.method === "CASH").reduce((s, p) => s + Number(p.p.amount), 0);
  // комплексная оплата: сколько осталось наличными и безналом (если доля наличных задана)
  const cashPlan = o.paymentMethod === "MIXED" ? num(o.cashPlanned) : null;
  const payPlan = cashPlan === null ? null : { cashLeft: cashPlan - paidCash, bankLeft: amount - cashPlan - (paid - paidCash) };
  const debtOrder = amount - paid;
  const debtShip = deliveredAmount - paid;
  const pct = qty > 0 ? (delivered / qty) * 100 : 0;
  // просрочка — по сроку каждой недопоставленной позиции (свой срок или общий)
  const overdue = ["SENT", "CONFIRMED", "AWAITING", "PARTIAL"].includes(o.status) && items.some((i) => !i.is_closed && Number(i.qty) > Number(i.delivered) && i.due_date && i.due_date < today());
  const nullPrice = items.some((i) => i.price === null);
  const openItems = items.filter((i) => !i.is_closed && Number(i.qty) > Number(i.delivered));

  // задачи «Закупка», которые подтверждены этим заказом
  const byTasks = (await db.execute(sql`SELECT t.id, t.title, t.status FROM task_orders x JOIN tasks t ON t.id = x.task_id WHERE x.order_id = ${o.id} AND t.deleted_at IS NULL`)).rows as { id: string; title: string; status: string }[];
  return (
    <>
      <PageHeader help={"order-card"}
        back={{ href: "/orders", label: "Заказы" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Заказ {orderNo(o.number)} <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
            {overdue && <Badge tone="red">поставка просрочена</Badge>}
          </span>
        }
        subtitle={
          <>
            <Link href={`/suppliers/${supplier.id}`} className="text-brand-700 hover:underline">
              {supplier.name}
            </Link>{" "}
            · от {fmtDate(o.orderDate)}
            {o.invoiceNumber && ` · счёт № ${o.invoiceNumber}`}
            {o.source?.startsWith("import") && <span className="ml-2 text-xs text-slate-400">(импорт из Excel: «{o.source.slice(7).split("!")[0]}», стр. {o.source.split("!")[1]?.split("#")[0]})</span>}
          </>
        }
        actions={
          canEdit ? (
            <>
              <ActionForm action={setOrderStatusAction} className="flex items-center gap-1">
                <input type="hidden" name="id" value={o.id} />
                <select name="status" defaultValue="" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
                  <option value="" disabled>
                    Сменить статус…
                  </option>
                  {["DRAFT", "SENT", "CONFIRMED", "AWAITING", ...(can(u, PERMS.ordersCancel) ? ["CANCELLED"] : [])].map((s) => (
                    <option key={s} value={s}>
                      {ORDER_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <SubmitButton size="sm" variant="secondary">
                  OK
                </SubmitButton>
              </ActionForm>
              <Link href={edit ? `/orders/${o.id}` : `/orders/${o.id}?edit=1`} className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                {edit ? "Закрыть редактирование" : "Редактировать"}
              </Link>
              {can(u, PERMS.deleteRecords) && (
                <ConfirmButton action={deleteOrderAction} question="Удалить заказ? Его можно будет восстановить в настройках." hidden={{ id: o.id }}>
                  Удалить
                </ConfirmButton>
              )}
            </>
          ) : undefined
        }
      />

      {byTasks.length > 0 && (
        <div className="mb-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-900">
          Заказ по задаче:{" "}
          {byTasks.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ", "}
              <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">«{t.title}»</Link> ({TASK_STATUS_LABEL[t.status]})
            </span>
          ))}
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Сумма заказа" value={fmtMoney(amount)} sub={nullPrice ? "есть позиции без цены" : `${items.length} поз.`} />
        <Stat label="Поставлено" value={fmtPct(pct)} sub={`${fmtQty(delivered)} из ${fmtQty(qty)} · остаток ${fmtQty(remaining)}`} />
        <Stat label="Сумма поставленного" value={fmtMoney(deliveredAmount)} />
        <Stat label="Оплачено" value={fmtMoney(paid)} sub={[amount > 0 ? `${fmtPct((paid / amount) * 100)} от заказа` : null, paidCash > 0 ? `нал ${fmtMoney(paidCash)} · безнал ${fmtMoney(paid - paidCash)}` : null].filter(Boolean).join(" · ") || undefined} />
        <Stat label="Долг по заказу" value={fmtMoney(debtOrder)} sub={debtOrder < 0 ? "переплата" : "сумма заказа − оплаты"} />
        <Stat label="Долг по отгрузке" value={fmtMoney(debtShip)} sub={debtShip < 0 ? "аванс у поставщика" : "поставлено − оплаты"} tone={debtShip > 0 ? "amber" : undefined} />
      </div>

      {edit && canEdit && opts && (
        <Card title="Реквизиты заказа" className="mb-4">
          <ActionForm action={updateOrderHeaderAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="id" value={o.id} />
            <Field label="Поставщик" className="sm:col-span-2">
              <Select searchable name="supplierId" defaultValue={o.supplierId} options={opt(opts.suppliers)} />
            </Field>
            <Field label="Дата заказа">
              <Input type="date" name="orderDate" defaultValue={o.orderDate} />
            </Field>
            {can(u, PERMS.ordersViewAll) && (
              <Field label="Закупщик">
                <Select searchable name="buyerId" defaultValue={o.buyerId ?? ""} placeholder="не назначен" options={opt(opts.buyers)} />
              </Field>
            )}
            <Field label="Наше юрлицо">
              <Select searchable name="legalEntityId" defaultValue={o.legalEntityId ?? ""} placeholder="—" options={opt(opts.legal)} />
            </Field>
            <Field label="Направление">
              <Select searchable name="directionId" defaultValue={o.directionId ?? ""} placeholder="—" options={opt(opts.directions)} />
            </Field>
            <Field label="№ счёта">
              <Input name="invoiceNumber" defaultValue={o.invoiceNumber ?? ""} />
            </Field>
            <Field label="Дата счёта">
              <Input type="date" name="invoiceDate" defaultValue={o.invoiceDate ?? ""} />
            </Field>
            <Field label="Общий срок поставки" hint="Свой срок у товара — в «Позициях заказа» → «Редактировать»">
              <Input type="date" name="plannedDeliveryDate" defaultValue={o.plannedDeliveryDate ?? ""} />
            </Field>
            <OrderPayFields method={o.paymentMethod} cash={o.cashPlanned === null ? null : String(Number(o.cashPlanned))} className="sm:col-span-2" />
            <Field label="Комментарий" className="sm:col-span-2 lg:col-span-3">
              <Input name="comment" defaultValue={o.comment ?? ""} />
            </Field>
            <div className="flex items-end">
              <SubmitButton>Сохранить</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Позиции заказа" pad={false}>
            <Table>
              <thead>
                <tr>
                  <Th>Товар</Th>
                  <Th right>Заказано · цена</Th>
                  <Th right>Сумма</Th>
                  <Th>Поставлено</Th>
                  <Th>Срок</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const p = Number(i.qty) > 0 ? (Number(i.delivered) / Number(i.qty)) * 100 : 0;
                  const rest = Number(i.qty) - Number(i.delivered);
                  return (
                    <Fragment key={i.id}>
                    <tr>
                      <Td className="min-w-[11rem]">
                        <Link href={`/products/${i.product_id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {i.product}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {i.direction && <Badge>{i.direction}</Badge>}
                          {i.is_closed && <Badge tone="gray" title={i.closed_note ?? ""}>закрыта{rest > 0 ? ` (недопоставка ${fmtQty(rest)})` : ""}</Badge>}
                          {rest < 0 && <Badge tone={i.over_delivery_approved ? "amber" : "red"}>сверх заказа +{fmtQty(-rest)}{i.over_delivery_approved ? ", подтверждено" : ""}</Badge>}
                          {i.price === null && <Badge tone="amber">нет цены</Badge>}
                        </div>
                        {i.note && <div className="mt-0.5 text-xs leading-snug text-slate-500">{i.note}</div>}
                      </Td>
                      <Td right>
                        <div className="font-medium text-slate-900">{fmtQty(i.qty)}</div>
                        <div className="text-xs text-slate-500">{i.price === null ? "без цены" : `по ${fmtPrice(i.price)}`}</div>
                      </Td>
                      <Td right>{i.price === null ? "—" : fmtMoney(Number(i.qty) * Number(i.price))}</Td>
                      <Td className="w-40 min-w-[8.5rem]">
                        <div className="flex items-baseline justify-between gap-2 tabular-nums">
                          <span className="font-medium text-slate-900">{fmtQty(i.delivered)}</span>
                          <span className="text-xs text-slate-500">{fmtPct(p)}</span>
                        </div>
                        <div className="my-1"><Progress value={p} tone={p >= 100 || i.is_closed ? "green" : "brand"} /></div>
                        <div className="whitespace-nowrap text-xs text-slate-500">{i.is_closed ? "закрыта" : rest > 0 ? `осталось ${fmtQty(rest)}` : "всё поставлено"}</div>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {i.item_due ? (
                          <span className="font-medium text-slate-900" title="Свой срок позиции">{fmtDate(i.item_due)}</span>
                        ) : (
                          <span className="text-slate-400" title="Общий срок заказа">{fmtDate(i.due_date)}</span>
                        )}
                        {!i.is_closed && rest > 0 && i.due_date && i.due_date < today() && <div className="mt-1"><Badge tone="red">просрочено</Badge></div>}
                      </Td>
                    </tr>
                    {edit && canEdit && (
                      <tr>
                        <td colSpan={5} className="border-b border-slate-100 px-3 pb-3">
                          <div className="rounded-lg bg-slate-50 p-2">
                            <ActionForm action={updateItemAction} className="flex flex-wrap items-end gap-2">
                              <input type="hidden" name="itemId" value={i.id} />
                              <Field label="Кол-во">
                                <Input name="qty" defaultValue={String(Number(i.qty))} className="w-24" />
                              </Field>
                              <Field label="Цена">
                                <Input name="price" defaultValue={i.price === null ? "" : String(Number(i.price))} className="w-24" />
                              </Field>
                              <Field label="Свой срок (пусто — общий)">
                                <Input name="due" type="date" defaultValue={i.item_due ?? ""} className="w-40" />
                              </Field>
                              <label className="flex items-center gap-1 pb-2 text-xs">
                                <input type="checkbox" name="isClosed" defaultChecked={i.is_closed} /> закрыта
                              </label>
                              <label className={cn("flex items-center gap-1 pb-2 text-xs", !can(u, PERMS.overDeliveryApprove) && "opacity-50")}>
                                <input type="checkbox" name="overDeliveryApproved" defaultChecked={i.over_delivery_approved} disabled={!can(u, PERMS.overDeliveryApprove)} /> разрешить превышение
                              </label>
                              <SubmitButton size="sm">Сохранить</SubmitButton>
                            </ActionForm>
                            <div className="mt-1">
                              <ConfirmButton action={deleteItemAction} question="Удалить позицию?" hidden={{ itemId: i.id }}>
                                Удалить позицию
                              </ConfirmButton>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
            {edit && canEdit && (
              <div className="border-t border-slate-100 p-3">
                <ActionForm action={addItemAction} resetOnOk className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={o.id} />
                  <Field label="Добавить товар">
                    <Combobox name="item_product" free options={opt(opts?.products ?? [])} placeholder="Название или артикул" className="w-64" inputClassName="py-2" />
                  </Field>
                  <Field label="Кол-во">
                    <Input name="item_qty" className="w-24" />
                  </Field>
                  <Field label="Цена">
                    <Input name="item_price" className="w-24" />
                  </Field>
                  <Field label="Срок, если другой">
                    <Input name="item_due" type="date" className="w-40" />
                  </Field>
                  <input type="hidden" name="item_direction" value="" />
                  <SubmitButton size="sm">Добавить</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>

          {canEdit && o.status !== "CANCELLED" && openItems.length > 0 && (
            <div id="deliver" className="scroll-mt-20">
            <Card title="Зарегистрировать поставку">
              <ActionForm action={registerDeliveryAction} resetOnOk>
                <input type="hidden" name="orderId" value={o.id} />
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Дата фактической поставки" required>
                    <Input type="date" name="date" defaultValue={today()} max={today()} required />
                  </Field>
                  <Field label="№ накладной">
                    <Input name="waybillNumber" />
                  </Field>
                  <Field label="Комментарий">
                    <Input name="comment" />
                  </Field>
                </div>
                <div className="space-y-2">
                  {openItems.map((i) => {
                    const rest = Math.max(Number(i.qty) - Number(i.delivered), 0);
                    return (
                      <div key={i.id} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-12">
                        <input type="hidden" name="di_item" value={i.id} />
                        <div className="col-span-2 text-sm sm:col-span-6">
                          {i.product}
                          <span className="ml-1 text-xs text-slate-500">ожидается {fmtQty(rest)}</span>
                        </div>
                        <input name="di_qty" inputMode="decimal" placeholder={`кол-во (до ${fmtQty(rest)})`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm sm:col-span-3" />
                        <input name="di_price" inputMode="decimal" defaultValue={i.price === null ? "" : String(Number(i.price))} placeholder="факт. цена" title="Фактическая цена за единицу" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm sm:col-span-3" />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <SubmitButton>Зарегистрировать поставку</SubmitButton>
                </div>
              </ActionForm>
            </Card>
            </div>
          )}

          <Card title={`Поставки (${delivs.length})`} pad={false}>
            {delivs.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Поставок ещё не было</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Дата</Th>
                    <Th>Товары</Th>
                    <Th right>Кол-во</Th>
                    <Th right>Сумма</Th>
                    <Th>Накладная</Th>
                    <Th>Кто</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {delivs.map(({ d, who }) => {
                    const its = dItems.filter((x) => x.di.deliveryId === d.id);
                    const q = its.reduce((s, x) => s + Number(x.di.qty), 0);
                    const a = its.reduce((s, x) => s + Number(x.di.qty) * (num(x.di.price) ?? 0), 0);
                    return (
                      <tr key={d.id}>
                        <Td className="whitespace-nowrap">
                          {fmtDate(d.date)}
                          {d.dateAssumed && <div><Badge tone="amber" title="Дата в Excel не указана, подставлена">дата условная</Badge></div>}
                        </Td>
                        <Td className="text-xs">
                          {its.map((x) => (
                            <div key={x.di.id}>
                              {x.product}: <b>{fmtQty(x.di.qty)}</b> × {fmtPrice(x.di.price)}
                            </div>
                          ))}
                          {d.comment && <div className="text-slate-400">{d.comment}</div>}
                        </Td>
                        <Td right>{fmtQty(q)}</Td>
                        <Td right>{fmtMoney(a)}</Td>
                        <Td>{d.waybillNumber ?? "—"}</Td>
                        <Td className="whitespace-nowrap text-xs text-slate-500">{who ?? "импорт"}</Td>
                        <Td>
                          {canEdit && (can(u, PERMS.deleteRecords) || d.createdById === u.id) && (
                            <ConfirmButton action={deleteDeliveryAction} question="Отменить поставку?" hidden={{ id: d.id }}>
                              ✕
                            </ConfirmButton>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <div id="payments" className="scroll-mt-20"><Card title={`Оплаты (${pays.length})`} pad={false}>
            {pays.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <Th>Дата</Th>
                    <Th>Тип</Th>
                    <Th right>Сумма</Th>
                    <Th>№ ПП</Th>
                    <Th>Комментарий</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {pays.map(({ p, who }) => (
                    <tr key={p.id}>
                      <Td className="whitespace-nowrap">{p.date ? fmtDate(p.date) : <Badge tone="amber">дата не указана</Badge>}</Td>
                      <Td>
                        {PAYMENT_TYPE_LABEL[p.type]}
                        {p.method === "CASH" && <span className="ml-1 text-xs text-slate-500">({PAYMENT_METHOD_LABEL.CASH})</span>}
                      </Td>
                      <Td right>{fmtMoney(p.amount, 2)}</Td>
                      <Td>{p.docNumber ?? "—"}</Td>
                      <Td className="text-xs text-slate-500">
                        {p.comment}
                        <div>{who ?? "импорт"}</div>
                      </Td>
                      <Td>
                        {canEdit && (can(u, PERMS.deleteRecords) || p.createdById === u.id) && (
                          <ConfirmButton action={deletePaymentAction} question="Удалить платёж?" hidden={{ id: p.id }}>
                            ✕
                          </ConfirmButton>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {canEdit && (
              <div className="border-t border-slate-100 p-4">
                <ActionForm action={registerPaymentAction} resetOnOk className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                  <input type="hidden" name="orderId" value={o.id} />
                  <Field label="Дата" required>
                    <Input type="date" name="date" defaultValue={today()} required />
                  </Field>
                  <Field label="Сумма, ₽" required>
                    <Input name="amount" inputMode="decimal" required placeholder={debtOrder > 0 ? String(Math.round(debtOrder * 100) / 100) : ""} />
                  </Field>
                  <Field label="Тип">
                    <Select name="type" defaultValue={paid === 0 ? "ADVANCE" : "PARTIAL"} options={Object.entries(PAYMENT_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
                  </Field>
                  <Field label="Способ">
                    <Select name="method" defaultValue={o.paymentMethod === "CASH" ? "CASH" : "BANK"} options={Object.entries(PAYMENT_METHOD_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
                  </Field>
                  <Field label="№ платёжного поручения">
                    <Input name="docNumber" />
                  </Field>
                  <div className="flex items-end">
                    <SubmitButton>Добавить оплату</SubmitButton>
                  </div>
                  <Field label="Комментарий" className="col-span-2 sm:col-span-6">
                    <Textarea name="comment" rows={1} />
                  </Field>
                </ActionForm>
              </div>
            )}
          </Card></div>
        </div>

        <div className="space-y-4">
          <Card title="Сведения">
            <dl className="space-y-2 text-sm">
              {[
                ["Закупщик", buyer?.name ?? "не назначен"],
                ["Наше юрлицо", legal ? (legal.shortName ? `${legal.shortName} (${legal.name})` : legal.name) : null],
                ["Направление", dir?.name],
                ["Дата счёта", o.invoiceDate ? fmtDate(o.invoiceDate) : null],
                ["Общий срок поставки", o.plannedDeliveryDate ? fmtDate(o.plannedDeliveryDate) : null],
                ["Способ оплаты", o.paymentMethod ? (o.paymentMethod === "MIXED" && cashPlan !== null ? `Комплексная: нал ${fmtMoney(cashPlan)}, безнал ${fmtMoney(amount - cashPlan)}` : ORDER_PAY_LABEL[o.paymentMethod]) : null],
                ...(payPlan ? ([["Осталось оплатить", `нал ${fmtMoney(Math.max(payPlan.cashLeft, 0))} · безнал ${fmtMoney(Math.max(payPlan.bankLeft, 0))}`]] as [string, string][]) : []),
                ["Создан", fmtDateTime(o.createdAt)],
                ["Комментарий", o.comment],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right text-slate-900">{v || "—"}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <DocumentsBlock entityType="order" entityId={o.id} canEdit={canEdit} />
          <CommentsBlock entityType="order" entityId={o.id} canEdit={u.role !== "VIEWER"} />
          <HistoryBlock entityType="order" entityId={o.id} />
        </div>
      </div>
    </>
  );
}
