export type Stage = "Draft" | "Sent" | "Negotiating" | "Signed" | "Lost";
export interface Customer {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  status: string;
  owner: string;
  activity: string;
  address: string;
  notes: { text: string; date: string }[];
}
export interface Contract {
  id: string;
  name: string;
  customerId: string;
  value: number;
  stage: Stage;
  eventDate: string;
  sent: string;
  owner: string;
  updated: string;
  priority: boolean;
  lossReason?: string;
}
export interface Item {
  id: string;
  name: string;
  category: string;
  unit: string;
  onHand: number;
  reserved: number;
  reorder: number;
  reorderQuantity: number;
  cost: number;
  supplier: string;
  notes: { text: string; date: string }[];
  history: {
    date: string;
    type: string;
    quantity: number;
    reference: string;
    by: string;
    balance: number;
  }[];
}
export interface Employee {
  id: string;
  name: string;
  role: string;
}
