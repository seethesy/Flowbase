import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { DeletableEntity } from "../../../shared/deletions";
import { deletions } from "../../db/schema";

// FLOW-260: a deleted record is archived and has an open deletions row. The
// Show archived lists use this to leave deleted records out (they come back only
// through Settings › Archived or Undo).
export const notDeleted = (entityType: DeletableEntity, id: PgColumn): SQL =>
  sql`not exists (select 1 from ${deletions} where ${deletions.entityType} = ${entityType} and ${deletions.entityId} = ${id} and ${deletions.restoredAt} is null)`;
