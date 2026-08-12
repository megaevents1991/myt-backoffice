"use client";

import { BLOB_SHAPES, hexToRgb } from "@/lib/forms/brand";

/**
 * The signature element: the site's own Figma blob shapes, tinted in the form's
 * accent and blurred into an ambient glow behind the cover panel. Same shapes
 * the OG images and the creative generator use, so a client who booked on the
 * site recognises the surface they are filling in.
 *
 * Decorative only - hidden from assistive tech, and the drift stops under
 * prefers-reduced-motion.
 */
export function BrandGlow({ accent }: { accent: string }) {
  const rgb = hexToRgb(accent);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes myt-drift-a {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50%      { transform: translate3d(4%, -6%, 0) scale(1.08); }
        }
        @keyframes myt-drift-b {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1.05); }
          50%      { transform: translate3d(-6%, 5%, 0) scale(0.95); }
        }
        @media (prefers-reduced-motion: reduce) {
          .myt-blob { animation: none !important; }
        }
      `}</style>

      <svg
        className="myt-blob absolute -left-[18%] -top-[12%] h-[70%] w-[80%] opacity-[0.55] blur-[64px]"
        style={{ animation: "myt-drift-a 22s ease-in-out infinite" }}
        viewBox={`0 0 ${BLOB_SHAPES[0].w} ${BLOB_SHAPES[0].h}`}
        fill="none"
      >
        <path d={BLOB_SHAPES[0].d} fill={`rgba(${rgb}, 0.85)`} />
      </svg>

      <svg
        className="myt-blob absolute -bottom-[16%] -right-[14%] h-[62%] w-[70%] opacity-[0.4] blur-[72px]"
        style={{ animation: "myt-drift-b 28s ease-in-out infinite" }}
        viewBox={`0 0 ${BLOB_SHAPES[1].w} ${BLOB_SHAPES[1].h}`}
        fill="none"
      >
        <path d={BLOB_SHAPES[1].d} fill={`rgba(${rgb}, 0.7)`} />
      </svg>

      <svg
        className="myt-blob absolute -bottom-[4%] left-[22%] h-[42%] w-[46%] opacity-[0.28] blur-[56px]"
        style={{ animation: "myt-drift-a 34s ease-in-out infinite reverse" }}
        viewBox={`0 0 ${BLOB_SHAPES[2].w} ${BLOB_SHAPES[2].h}`}
        fill="none"
      >
        <path d={BLOB_SHAPES[2].d} fill={`rgba(${rgb}, 0.6)`} />
      </svg>
    </div>
  );
}
