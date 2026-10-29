export const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

export function dateOnly(value: string): string | null {
  const text = clean(value).replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function firstNumber(value: string): number | null {
  const match = value.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function dollars(value: string): number | null {
  const match = value.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  return match ? Math.round(Number(match[1].replace(/,/g, "")) * 100) : null;
}

export function emailFrom(value: string): string {
  return value.match(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? "";
}

export function phoneFrom(value: string): string {
  return value.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ?? "";
}
