import { z } from "zod";
import { useResource } from "../app/useResource";
import { request } from "../services/core";
import { PageHeader, Section, LoadingSkeleton } from "../components/shared";
import { LoadError } from "../components/record-display";
const ordersSchema = z.array(z.object({ id: z.string(), fromDate: z.string(), toDate: z.string(), status: z.string() }));
export function KitchenOrderStatus() {
  const orders = useResource(["kitchen-order-status"], () => request(ordersSchema, "/api/home/kitchen-orders"));
  return <><PageHeader title="Order list status" subtitle="Current kitchen purchasing lists" />
    {orders.error ? <LoadError message={orders.error} /> : !orders.data ? <LoadingSkeleton /> :
      <Section title="Order lists"><ul>{orders.data.map((order) =>
        <li key={order.id}>{order.fromDate} to {order.toDate} · {order.status.replaceAll("_", " ")}</li>)}</ul></Section>}
  </>;
}
