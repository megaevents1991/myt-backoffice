"use client";

import React from "react";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
// 23 screens (offline flights, hotels, events...) call react-hot-toast; its Toaster was never
// mounted, so every one of their success/error messages was invisible (28.09: "Validate does
// nothing" on /offline-flights/new - the call answered, the toast had nowhere to show).
import { Toaster as HotToaster } from "react-hot-toast";
import { AuthProvider } from "@/contexts/auth-context";
import { ConfirmProvider } from "@/components/confirm-provider";

// Brand faces, loaded once for the whole app: Assistant for UI/body, Rubik for
// display. Both cover Hebrew natively, so טפסים / תבניות stop falling back to
// a system face. The portal aliases --font-portal-* onto these in globals.css.
// Bundled, never next/font/google: Google's answer can fail the build (app/fonts/README.md).
const assistant = localFont({
  src: [
    { path: "./fonts/assistant.woff2", weight: "400" },
    { path: "./fonts/assistant.woff2", weight: "500" },
    { path: "./fonts/assistant.woff2", weight: "600" },
    { path: "./fonts/assistant.woff2", weight: "700" },
  ],
  variable: "--font-sans",
  adjustFontFallback: false,
  fallback: ["Assistant Fallback"],
});

const rubik = localFont({
  src: [
    { path: "./fonts/rubik.woff2", weight: "500" },
    { path: "./fonts/rubik.woff2", weight: "600" },
    { path: "./fonts/rubik.woff2", weight: "700" },
  ],
  variable: "--font-display",
  adjustFontFallback: false,
  fallback: ["Rubik Fallback"],
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning={true}>
      <body
        className={`${assistant.variable} ${rubik.variable}`}
        suppressHydrationWarning={true}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ConfirmProvider>
            <AuthProvider>{children}</AuthProvider>
          </ConfirmProvider>
          <Toaster />
          <HotToaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
