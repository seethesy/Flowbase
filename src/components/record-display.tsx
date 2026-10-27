export const initials = (name: string) =>
  name
    .replace(/&/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("");

export function LoadError({ message }: { message: string }) {
  return (
    <p role="alert" className="error-message">
      {message}
    </p>
  );
}

export const hidden = (value: string | null) =>
  value === null ? "Hidden" : value || "—";

