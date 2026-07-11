import type { ProductData, SetData } from '../content/schemas';

export interface Entry<T> {
  id: string;
  data: T;
}

export function getActiveSet(sets: Entry<SetData>[], now: Date = new Date()): Entry<SetData> | null {
  return sets.find((s) => s.data.startDate <= now && now <= s.data.endDate) ?? null;
}

export function getSetProducts(setId: string, products: Entry<ProductData>[]): Entry<ProductData>[] {
  return products.filter((p) => p.data.setId === setId);
}

export function getEntriesByIds<T>(ids: string[], entries: Entry<T>[]): Entry<T>[] {
  return ids
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is Entry<T> => entry !== undefined);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
