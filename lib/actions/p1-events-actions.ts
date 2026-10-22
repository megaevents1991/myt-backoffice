// lib/actions/p1-events-actions.ts

import { P1EventDB, P1Ticket } from "@/types/p1-events.types";

/**
 * Fetch P1 events
 */
export async function getP1Events(options?: {
  category?: string;
  series?: string;
}): Promise<P1EventDB[]> {
  // slim=true: list rows come back WITHOUT the embedded tickets JSONB - the
  // page lazy-loads tickets per selected event (see getP1Tickets).
  let url = "/api/p1-events/events?limit=10000&upcoming=true&slim=true";

  if (options?.category) {
    url += `&category=${encodeURIComponent(options.category)}`;
  }

  if (options?.series) {
    url += `&series=${encodeURIComponent(options.series)}`;
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch P1 events");
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch a single P1 event by ID
 */
export async function getP1EventById(
  eventId: string,
): Promise<P1EventDB | null> {
  const url = `/api/p1-events/events?event_id=${eventId}&limit=1`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch P1 event");
  const json = await res.json();
  const list: P1EventDB[] = json.data || [];
  return list[0] || null;
}

/**
 * Fetch P1 tickets for a specific event (from embedded data)
 */
export async function getP1Tickets(eventId: string): Promise<P1Ticket[]> {
  try {
    const event = await getP1EventById(eventId);
    if (event && Array.isArray(event.tickets)) {
      return event.tickets;
    }
  } catch (e) {
    console.error("getP1Tickets failed", e);
  }
  return [];
}

/**
 * Get sync status from the API
 */
export async function getP1SyncStatus() {
  try {
    const response = await fetch("/api/p1-events/sync", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Failed to get P1 sync status: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to get P1 sync status:", error);
    throw error;
  }
}

/**
 * Trigger data sync from P1 XML feeds
 */
export async function triggerP1Sync() {
  try {
    const response = await fetch("/api/p1-events/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to trigger P1 sync: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to trigger P1 sync:", error);
    throw error;
  }
}
