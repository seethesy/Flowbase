import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { recordSchemas } from "../../shared/records";
import { createRecordService, type RecordService } from "../services/records";

function useCollection<T extends { id: string }>(service: RecordService<T>) {
  const [records, setRecords] = useState<T[]>([]);
  const load = useCallback(async () => setRecords(await service.list()), [service]);
  return {
    records,
    find: (id: string) => records.find((r) => r.id === id),
    load,
    save: async (record: T) => {
      await service.save(record);
      setRecords([...(await service.list())]);
    },
    remove: async (id: string) => {
      await service.remove(id);
      setRecords([...(await service.list())]);
    },
  };
}
function useStore() {
  const [services] = useState(() => ({
    clients: createRecordService("clients", recordSchemas.clients),
    proposals: createRecordService("proposals", recordSchemas.proposals),
    inventory: createRecordService("inventory", recordSchemas.inventory),
  }));
  const clients = useCollection(services.clients);
  const proposals = useCollection(services.proposals);
  const inventory = useCollection(services.inventory);
  const [toast, setToast] = useState("");
  return {
    clients,
    proposals,
    inventory,
    toast,
    notify: (message: string) => {
      setToast(message);
      window.setTimeout(() => setToast(""), 4500);
    },
  };
}
type Store = ReturnType<typeof useStore>;
const Context = createContext<Store | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  return <Context.Provider value={store}>{children}{store.toast && <div role="status" className="toast">{store.toast}</div>}</Context.Provider>;
}
// Mount only on screens which still consume fixtures. The services retain edits
// when users visit real-record screens and return during the same session.
export function DemoScreen({ children }: { children: ReactNode }) {
  const store = useDemo();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const clients = store.clients.load;
  const proposals = store.proposals.load;
  const inventory = store.inventory.load;
  useEffect(() => {
    let active = true;
    Promise.all([clients(), proposals(), inventory()]).then(() => {
      if (active) setLoading(false);
    }).catch(() => {
      if (active) setError("Unable to load demo records. Please refresh to retry.");
    });
    return () => { active = false; };
  }, [clients, proposals, inventory]);
  if (error) return <p role="alert">{error}</p>;
  if (loading) return <p role="status">Loading sample data…</p>;
  return children;
}
export function useDemo() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Missing DemoProvider");
  return ctx;
}
