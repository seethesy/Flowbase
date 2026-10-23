import { searchResultSchema } from "../../shared/search";
import { query, request } from "./core";

// Client for global search (FLOW-46).
export const searchApi = {
  search: (q: string) =>
    request(searchResultSchema.array(), `/api/search${query({ q })}`),
};
