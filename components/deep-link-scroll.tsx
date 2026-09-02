"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** How long to keep waiting for a late-rendering target before giving up. */
const WAIT_MS = 6000;

/**
 * Makes #hash deep links land even when the target renders after data loads.
 *
 * The creative-gaps "Do" button links to the exact control that fixes a gap
 * (#fix-logo, #section-images...). On a server-rendered form the browser
 * scrolls by itself, but the event editor builds its cards after a fetch - by
 * then the browser has already given up, and you arrive at the top of a
 * 3,000-line form with no idea where you were sent.
 *
 * So: try immediately, and if the element is not there yet, watch for it.
 */
export function DeepLinkScroll() {
  const pathname = usePathname();

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;

    const reveal = (element: Element) => {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      // Re-apply :target so the arrival flash plays for a late element too.
      const { hash, pathname: path, search } = window.location;
      window.history.replaceState(null, "", `${path}${search}`);
      window.history.replaceState(null, "", `${path}${search}${hash}`);
    };

    const existing = document.getElementById(id);
    if (existing) {
      reveal(existing);
      return;
    }

    let timer = 0;
    const observer = new MutationObserver(() => {
      const element = document.getElementById(id);
      if (!element) return;
      observer.disconnect();
      window.clearTimeout(timer);
      reveal(element);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = window.setTimeout(() => observer.disconnect(), WAIT_MS);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [pathname]);

  return null;
}
