import { ApiError } from "../hono";

// Compare fields and sort order before writing. Supplied ids must belong to
// this parent; a foreign id is not treated as a new child.
export function diffChildren<Input extends { id?: string }, Existing extends { id: string }>(
  existing: Existing[],
  inputs: Input[],
  values: (input: Input, sortOrder: number) => Record<string, unknown>,
) {
  const same = (stored: unknown, desired: unknown) =>
    Object.is(stored, desired) ||
    (stored !== null && stored !== undefined && desired !== null && desired !== undefined &&
      typeof stored !== "object" && typeof desired !== "object" && String(stored) === String(desired));
  const byId = new Map(existing.map((row) => [row.id, row]));
  const kept = new Set<string>();
  const insert: { input: Input; sortOrder: number }[] = [];
  const update: { id: string; input: Input; sortOrder: number }[] = [];
  for (const [sortOrder, input] of inputs.entries()) {
    if (!input.id) {
      insert.push({ input, sortOrder });
      continue;
    }
    const row = byId.get(input.id);
    if (!row || kept.has(input.id))
      throw new ApiError(400, "INVALID_REQUEST", "Child row does not belong to this record or was repeated.");
    kept.add(input.id);
    const desired = values(input, sortOrder);
    if (Object.entries(desired).some(([key, value]) =>
      key !== "updatedBy" && value !== undefined && !same(row[key as keyof Existing], value)))
      update.push({ id: input.id, input, sortOrder });
  }
  return { insert, update, archive: existing.filter((row) => !kept.has(row.id)).map((row) => row.id) };
}

export async function syncChildren<Input extends { id?: string }, Existing extends { id: string }>(
  existing: Existing[],
  inputs: Input[],
  values: (input: Input, sortOrder: number) => Record<string, unknown>,
  ops: {
    insert: (rows: { input: Input; sortOrder: number }[]) => Promise<unknown>;
    update: (id: string, input: Input, sortOrder: number) => Promise<unknown>;
    archive: (ids: string[]) => Promise<unknown>;
  },
) {
  const diff = diffChildren(existing, inputs, values);
  if (diff.insert.length) await ops.insert(diff.insert);
  for (const row of diff.update) await ops.update(row.id, row.input, row.sortOrder);
  if (diff.archive.length) await ops.archive(diff.archive);
  return diff;
}

// Digits only, without a leading US country code, for duplicate matching.
export function phoneDigits(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}
