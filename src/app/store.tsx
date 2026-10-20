import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { recordSchemas } from "../../shared/records";
import { createRecordService, type RecordService } from "../services/records";

function useCollection<T extends { id: string }>(service: RecordService<T>) {
  const [records, setRecords] = useState<T[]>([]);
  return {
    records,
    find: (id: string) => records.find((r) => r.id === id),
    load: async () => setRecords(await service.list()),
    save: async (record: T) => { await service.save(record); setRecords([...(await service.list())]); },
    remove: async (id: string) => { await service.remove(id); setRecords([...(await service.list())]); },
  };
}
function useStore() {
  const [services] = useState(() => ({
    customers: createRecordService("customers", recordSchemas.customers),
    contracts: createRecordService("contracts", recordSchemas.contracts),
    inventory: createRecordService("inventory", recordSchemas.inventory),
  }));
  const customers = useCollection(services.customers);
  const contracts = useCollection(services.contracts);
  const inventory = useCollection(services.inventory);
  const [toast, setToast] = useState("");
  return { customers, contracts, inventory, toast,
    notify: (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 4500); },
  };
}
type Store = ReturnType<typeof useStore>;
const Context = createContext<Store | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([store.customers.load(), store.contracts.load(), store.inventory.load()])
      .then(() => { if (active) setLoading(false); })
      .catch(() => { if (active) setError("Unable to load demo records. Please refresh to retry."); });
    return () => { active = false; };
    // Services live for the lifetime of this provider.
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (loading) return <p role="status">Loading workspace…</p>;
  return <Context.Provider value={store}>{children}{store.toast && <div role="status" className="toast">{store.toast}</div>}</Context.Provider>;
}
export function useDemo() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Missing DemoProvider");
  return ctx;
}
