"use client";

// Real places, from OpenStreetMap through Photon, a free lookup made for search-as-you-type.
// No account and no key. Fair use only, which one person typing place names stays far inside.
export type Spot = { label: string; lat: number; lng: number };

type Props = { name?: string; district?: string; locality?: string; city?: string; county?: string; state?: string; country?: string };
type Feature = { geometry: { coordinates: [number, number] }; properties: Props };

const BASE = "https://photon.komoot.io";

function label(p: Props, parts: (string | undefined)[]): string {
  return [...new Set([...parts, p.country].filter((x): x is string => !!x))].slice(0, 3).join(", ");
}

/** Suggestions for what Kofi has typed. Results near Ghana come first, but anywhere in the world can be found. */
export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Spot[]> {
  try {
    const res = await fetch(`${BASE}/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=5.6&lon=-0.2`, { signal });
    if (!res.ok) return [];
    const j = (await res.json()) as { features?: Feature[] };
    return (j.features || []).map((f) => ({
      label: label(f.properties, [f.properties.name, f.properties.city || f.properties.district || f.properties.county || f.properties.state]),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    })).filter((s) => s.label);
  } catch {
    return [];
  }
}

/** The name of the place at a map position: neighbourhood, town, country. */
export async function nameOf(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/reverse?lat=${lat}&lon=${lng}&lang=en`);
    if (!res.ok) return null;
    const p = ((await res.json()) as { features?: Feature[] }).features?.[0]?.properties;
    return p ? label(p, [p.district || p.locality, p.city || p.county || p.state]) || null : null;
  } catch {
    return null;
  }
}
