import { sopSchema, sopSummarySchema, type SopInput, type SopUpdate } from "../../shared/sops";
import { request } from "./core";

const base = "/api/sops";
export const sopsApi = {
  list: (q = "", category = "") => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    const query = params.toString();
    return request(sopSummarySchema.array(), query ? `${base}?${query}` : base);
  },
  get: (id: string) => request(sopSchema, `${base}/${encodeURIComponent(id)}`),
  create: (input: SopInput) => request(sopSchema, base, "POST", input),
  update: (id: string, input: SopUpdate) =>
    request(sopSchema, `${base}/${encodeURIComponent(id)}`, "PUT", input),
};
