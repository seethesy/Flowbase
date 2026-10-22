// Applies an edited child list (contacts, areas) to the stored rows: entries with a
// known id are updated, the rest are inserted, and stored rows missing from the
// list are archived. Rows are never hard-deleted.
export async function syncChildren<Input extends { id?: string }>(
  existingIds: string[],
  inputs: Input[],
  ops: {
    insert: (input: Input, sortOrder: number) => Promise<unknown>;
    update: (id: string, input: Input, sortOrder: number) => Promise<unknown>;
    archive: (ids: string[]) => Promise<unknown>;
  },
) {
  const kept = new Set<string>();
  for (const [sortOrder, input] of inputs.entries()) {
    if (input.id && existingIds.includes(input.id)) {
      kept.add(input.id);
      await ops.update(input.id, input, sortOrder);
    } else await ops.insert(input, sortOrder);
  }
  const removed = existingIds.filter((id) => !kept.has(id));
  if (removed.length) await ops.archive(removed);
}

// Digits only, without a leading US country code, for duplicate matching.
export function phoneDigits(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}
