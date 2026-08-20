"use client";

import { useEffect, useRef } from "react";
import { checkPortalSessionAlive } from "@/lib/actions/portal-actions";

/** 60s poll per open portal tab - accepted cost (QA item 10, Dor 20.08). */
const POLL_MS = 60_000;

/**
 * Kicks a DISABLED partner's already-open tab instead of leaving it visually
 * "logged in" until the next click/refresh. Every server action already
 * re-checks is_active (fail-closed - requirePartner in lib/auth/guards.ts);
 * this just polls that same check from an idle tab and on refocus, and
 * hard-redirects on a denial. Renders nothing.
 *
 * Mount ONLY for partner-role sessions (see app/portal/layout.tsx) - staff
 * debugging the portal have no partner_code, so their own requirePartner
 * call would return alive: false and kick them out of their own dashboard
 * session.
 */
export function SessionWatch() {
  const inFlightRef = useRef(false);

  useEffect(() => {
    async function check() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const { alive } = await checkPortalSessionAlive();
        if (!alive) {
          // Hard redirect, not router.push - clears any partner data/UI
          // state already rendered for the now-disabled account.
          window.location.replace("/auth/login");
        }
      } catch {
        // Transport-level failure (network blip, dropped connection) - never
        // a kick. Only an explicit { alive: false } from the server (which
        // checkPortalSessionAlive always resolves, never throws) redirects;
        // a failed round-trip says nothing about the session and must not
        // surface as an unhandled rejection either.
      } finally {
        inFlightRef.current = false;
      }
    }

    const interval = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, []);

  return null;
}
