import { createContext, useContext, useState, type ReactNode } from "react";
import * as fixtures from "../data/mock/fixtures";
import type { Customer, Contract, Item } from "../types";
import { createRecordService } from "../services/records";
function useStore() {
  const [customers, setCustomers] = useState<Customer[]>(fixtures.customers);
  const [contracts, setContracts] = useState<Contract[]>(fixtures.contracts);
  const [inventory, setInventory] = useState<Item[]>(fixtures.inventory);
  const [toast, setToast] = useState("");
  return {
    customers: createRecordService(customers, setCustomers),
    contracts: createRecordService(contracts, setContracts),
    inventory: createRecordService(inventory, setInventory),
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
  return (
    <Context.Provider value={store}>
      {children}
      {store.toast && (
        <div role="status" className="toast">
          {store.toast}
        </div>
      )}
    </Context.Provider>
  );
}
export function useDemo() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Missing DemoProvider");
  return ctx;
}
