import type { ReactNode } from "react";
import type { Actor } from "../../shared/access";
import {
  can,
  canCountItem,
  canMoveItem,
  type Action,
} from "../../shared/policy";
import { useAuth } from "./auth";

export function usePermissions() {
  const auth = useAuth();
  const actor: Actor | null = auth
    ? {
        userId: auth.user.id,
        role: auth.user.role,
        employmentType: auth.user.employmentType,
      }
    : null;
  return {
    actor,
    can: (action: Action) => actor !== null && can(actor, action),
  };
}

// UI convenience only. The API always enforces the same policy independently.
export function Allowed({
  action,
  item,
  children,
}: {
  action: Action;
  item?: { kind: string; subtype: string | null };
  children: ReactNode;
}) {
  const permissions = usePermissions();
  if (!permissions.actor || !permissions.can(action)) return null;
  if (
    item &&
    action === "inventory.count" &&
    !canCountItem(permissions.actor, item)
  )
    return null;
  if (
    item &&
    action === "inventory.move" &&
    !canMoveItem(permissions.actor, item)
  )
    return null;
  return children;
}
