import { deletePermission, type DeletableEntity } from "../../shared/deletions";
import type { SelectionOptions } from "../components/shared/table-selection-ui";
import { deletionsApi } from "../services/deletions";
import { usePermissions } from "./permissions";

// FLOW-260: Delete and Undo for a table of one record type. Delete is offered
// only to people who can edit the records; reload refreshes the table after a
// delete or a restore.
export function useDeletable(
  entityType: DeletableEntity,
  reload: () => void,
): Pick<SelectionOptions, "onDelete" | "onRestore"> {
  const { can } = usePermissions();
  if (!can(deletePermission[entityType])) return {};
  return {
    onDelete: async (ids) => {
      const result = await deletionsApi.remove(entityType, ids);
      reload();
      return result;
    },
    onRestore: async (ids) => {
      await deletionsApi.restore(entityType, ids);
      reload();
    },
  };
}
