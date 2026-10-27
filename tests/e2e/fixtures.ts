import { randomUUID } from "node:crypto";
import type { Client, FlowEvent } from "../../shared/core-records";
import type { InventoryItem, Section } from "../../shared/inventory";
import type { Lead } from "../../shared/leads";

export const fallGala = (): FlowEvent => ({
  id: "e0000000-0000-4000-8000-000000000001",
  title: "Fall gala",
  date: "2026-11-14",
  startTime: "18:00",
  endTime: null,
  startsAt: "2026-11-14T23:00:00.000Z",
  endsAt: null,
  client: { id: juniper().id, name: juniper().name },
  pocContactId: juniper().contacts[0].id,
  venue: null,
  address: "100 Garden Way, Arlington, VA",
  areas: [],
  eventType: "Gala",
  serviceType: "",
  foodServiceStyle: "",
  guestCount: 120,
  servingsCount: null,
  assignedSalespersonId: null,
  productionLeadId: null,
  assistantLeadIds: [],
  dressCode: "",
  arrivalTime: null,
  transportationNotes: "",
  internalNotes: "",
  status: "closed",
  bookedAt: "2026-10-22T09:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-22T09:00:00.000Z",
  updatedAt: "2026-10-22T09:00:00.000Z",
});

export const juniper = (): Client => ({
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Juniper & Co.",
  kind: "organization",
  assignedSalespersonId: null,
  notes: "",
  tags: [],
  contacts: [
    {
      id: "c0000000-0000-4000-8000-0000000000a1",
      name: "Olivia Bennett",
      role: "primary_poc",
      email: "olivia@juniper.example",
      phone: "202-555-0101",
      notes: "",
    },
  ],
  possibleDuplicateOf: null,
  archivedAt: null,
  createdAt: "2026-10-22T09:00:00.000Z",
  updatedAt: "2026-10-22T09:00:00.000Z",
});

const sectionRow = (
  index: number,
  name: string,
  kind: Section["kind"],
): Section => ({
  id: `d0000000-0000-4000-8000-00000000000${index}`,
  name,
  kind,
  totalQuantity: 0,
  archivedAt: null,
});
export const defaultSections = [
  sectionRow(1, "Warehouse", "rental"),
  sectionRow(2, "Jamie's", "rental"),
  sectionRow(3, "Cafe", "rental"),
  sectionRow(4, "Vendor", "rental"),
  sectionRow(5, "Kitchen – Dry Storage", "consumable"),
  sectionRow(6, "Kitchen – Refrigerated", "consumable"),
  sectionRow(7, "Bar Storage", "consumable"),
];

export const chairs = (): InventoryItem => ({
  id: "e0000000-0000-4000-8000-000000000001",
  kind: "rental",
  subtype: "furniture",
  code: "CH-001",
  name: "Chiavari Chair",
  category: "Chairs",
  description: "",
  unit: "each",
  group: "",
  color: "Gold",
  tier: "",
  ratio: { quantity: 1, basis: "per_guest" },
  active: true,
  rental: { priceCents: 800 },
  service: null,
  consumable: null,
  bar: null,
  stock: [
    {
      sectionId: defaultSections[0].id,
      sectionName: "Warehouse",
      quantity: 40,
    },
    { sectionId: defaultSections[2].id, sectionName: "Cafe", quantity: 10 },
  ],
  totalQuantity: 50,
  belowPar: null,
  archivedAt: null,
  createdAt: "2026-10-22T09:00:00.000Z",
  updatedAt: "2026-10-22T09:00:00.000Z",
});

// A consumable as the API returns it, kept in Kitchen – Refrigerated unless the
// overrides say otherwise.
export const consumable = (
  name: string,
  overrides: Partial<InventoryItem> & {
    details?: Partial<NonNullable<InventoryItem["consumable"]>>;
    onHand?: number;
  } = {},
): InventoryItem => {
  const { details, onHand = 0, ...item } = overrides;
  const storage =
    defaultSections.find(
      (section) => section.id === details?.storageSectionId,
    ) ?? defaultSections[5];
  const parLevel = details?.parLevel ?? null;
  return {
    id: randomUUID(),
    kind: "consumable",
    subtype: "ingredient",
    code: "",
    name,
    category: "",
    description: "",
    unit: "each",
    group: "",
    color: "",
    tier: "",
    ratio: null,
    active: true,
    rental: null,
    service: null,
    bar: null,
    stock: onHand
      ? [{ sectionId: storage.id, sectionName: storage.name, quantity: onHand }]
      : [],
    totalQuantity: onHand,
    belowPar: parLevel === null ? null : onHand < parLevel,
    archivedAt: null,
    createdAt: "2026-10-22T09:00:00.000Z",
    updatedAt: "2026-10-22T09:00:00.000Z",
    ...item,
    consumable: {
      purchaseUnit: "each",
      packCount: null,
      eachSize: null,
      recipeUnit: null,
      unitCostCents: null,
      costHidden: false,
      preferredVendor: "",
      parLevel,
      allergens: [],
      storageSectionId: storage.id,
      storageSectionName: storage.name,
      storageOrder: null,
      ...details,
    },
  };
};

let leadCounter = 0;
export const lead = (overrides: Partial<Lead> = {}): Lead => {
  leadCounter += 1;
  return {
    id: `d0000000-0000-4000-8000-${String(leadCounter).padStart(12, "0")}`,
    receivedAt: `2026-10-${String(10 + (leadCounter % 18)).padStart(2, "0")}T14:00:00.000Z`,
    channel: "webhook",
    source: "Bark",
    sourceLeadId: `bark-${leadCounter}`,
    sourceLeadUrl: "",
    purchased: false,
    name: `Lead ${leadCounter}`,
    email: `lead${leadCounter}@example.com`,
    phone: "202-555-0100",
    eventDate: "2026-12-05",
    guestCount: 60,
    location: "Brooklyn, NY",
    eventType: "Wedding",
    budgetCents: null,
    message: "",
    status: "new",
    lostReason: "",
    firstRespondedAt: null,
    firstResponseSeconds: null,
    assignedSalespersonId: null,
    convertedClientId: null,
    convertedEventId: null,
    needsReview: false,
    rawPayload: null,
    mergedIntoLeadId: null,
    archivedAt: null,
    createdAt: "2026-10-10T14:00:00.000Z",
    updatedAt: "2026-10-10T14:00:00.000Z",
    ...overrides,
  };
};
