import { redirect } from "next/navigation";

/** Поставка регистрируется на странице заказа: выбираем заказ из списка ожидаемых */
export default function NewDelivery() {
  redirect("/deliveries?tab=expected");
}
