export const roleLabel = (role: string) =>
  role
    .split("_")
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
