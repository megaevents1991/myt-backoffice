/**
 * Signs a quote into its payment link: `&quote={id}&qsig={sig}`, where sig =
 * HMAC-SHA256 over `quote:{id}:{totalUsd}` with NEXT_SECRET_SESSION_SECRET
 * (same cross-app parity contract as the partner handoff). myt-main's
 * /api/quote-offer verifies it (lib/quote-link.ts there) and then renders the
 * offer and charges the agent's total on the order page.
 *
 * Missing secret degrades soft: the link ships unsigned and main simply
 * ignores the quote - the customer still lands on a working package link.
 */

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signQuoteLink(
  paymentLink: string,
  quoteId: number,
  /** quotes.total - USD rounded to 2 decimals; must match what main verifies. */
  totalUsd: number,
): Promise<string> {
  const secret = process.env.NEXT_SECRET_SESSION_SECRET;
  if (!secret) {
    console.error(
      "signQuoteLink: NEXT_SECRET_SESSION_SECRET missing - quote link ships unsigned (offer display/price on main disabled)",
    );
    return paymentLink;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`quote:${quoteId}:${totalUsd}`),
      ),
    ),
  );
  const sep = paymentLink.includes("?") ? "&" : "?";
  return `${paymentLink}${sep}quote=${quoteId}&qsig=${encodeURIComponent(sig)}`;
}
