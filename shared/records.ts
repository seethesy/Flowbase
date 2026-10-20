import { z } from "zod";

const note = z.object({ text: z.string(), date: z.string() });
export const stageSchema = z.enum(["Draft", "Sent", "Negotiating", "Signed", "Lost"]);
export const clientSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), contact: z.string(),
  email: z.string(), phone: z.string(), status: z.string(), owner: z.string(),
  activity: z.string(), address: z.string(), notes: z.array(note),
});
export const proposalSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), clientId: z.string(),
  value: z.number().finite(), stage: stageSchema, eventDate: z.string(),
  sent: z.string(), owner: z.string(), updated: z.string(), priority: z.boolean(),
  lossReason: z.string().optional(),
});
export const itemSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), category: z.string(), unit: z.string(),
  onHand: z.number().finite().nonnegative(), reserved: z.number().finite().nonnegative(),
  reorder: z.number().finite().nonnegative(), reorderQuantity: z.number().finite().nonnegative(),
  cost: z.number().finite().nonnegative(), vendor: z.string(), notes: z.array(note),
  history: z.array(z.object({ date: z.string(), type: z.string(), quantity: z.number(),
    reference: z.string(), by: z.string(), balance: z.number() })),
});
export const recordSchemas = { clients: clientSchema, proposals: proposalSchema, inventory: itemSchema };
export type Stage = z.infer<typeof stageSchema>;
export type Client = z.infer<typeof clientSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Item = z.infer<typeof itemSchema>;
