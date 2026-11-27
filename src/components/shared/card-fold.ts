import { useState } from "react";

// Folding cards (FLOW-347). A card starts open or closed as its screen says;
// once the person folds or unfolds it, this device remembers that for them
// (FLOW-347 A1), per page and card. Folding never touches the saved layout.

const storageKey = (userId: string, pageKey: string, cardKey: string) =>
  `flowbase.card-fold.${userId}.${pageKey}.${cardKey}`;

function readFolded(key: string): boolean | null {
  try {
    const value = window.localStorage.getItem(key);
    return value === "closed" ? true : value === "open" ? false : null;
  } catch {
    return null;
  }
}

function writeFolded(key: string, folded: boolean) {
  try {
    window.localStorage.setItem(key, folded ? "closed" : "open");
  } catch {
    // Private windows and blocked storage: folding still works for the visit.
  }
}

export function useCardFold({ userId, pageKey, cardKey, defaultOpen }: {
  userId: string | null;
  pageKey: string;
  cardKey: string;
  defaultOpen: boolean;
}): [boolean, () => void] {
  const key = userId ? storageKey(userId, pageKey, cardKey) : null;
  const [folded, setFolded] = useState(() => (key ? readFolded(key) : null) ?? !defaultOpen);
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    if (key) writeFolded(key, next);
  };
  return [folded, toggle];
}
