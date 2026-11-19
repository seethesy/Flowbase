import { z } from "zod";
import { useResource } from "../app/useResource";
import { request } from "../services/core";
import { PageHeader, Section, LoadingSkeleton } from "../components/shared";
import { LoadError } from "../components/record-display";
import { T } from "../app/live-copy";
const ordersSchema = z.array(z.object({ id: z.string(), fromDate: z.string(), toDate: z.string(), status: z.string() }));
export function KitchenOrderStatus() {
  const orders = useResource(["kitchen-order-status"], () => request(ordersSchema, "/api/home/kitchen-orders"));
  return <><PageHeader title={<T id="kitchen-orders.kitchen-order-status.order-list-status">Order list status</T>} subtitle={<T id="kitchen-orders.kitchen-order-status.current-kitchen-purchasing-lists">Current kitchen purchasing lists</T>} />
    {orders.error ? <LoadError message={orders.error} /> : !orders.data ? <LoadingSkeleton /> :
      <Section title={<T id="kitchen-orders.kitchen-order-status.order-lists">Order lists</T>}><ul>{orders.data.map((order) =>
        <li key={order.id}><T id="kitchen-orders.kitchen-order-status.to" values={{ fromDate: order.fromDate, toDate: order.toDate, replaceAll: order.status.replaceAll("_", " ") }}>{"{fromDate} to {toDate} · {replaceAll}"}</T></li>)}</ul></Section>}
  </>;
}
