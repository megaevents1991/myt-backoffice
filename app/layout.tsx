"use client";

import React from "react";
import { Assistant, Rubik } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/contexts/auth-context";
import { ConfirmProvider } from "@/components/confirm-provider";

// Brand faces, loaded once for the whole app: Assistant for UI/body, Rubik for
// display. Both cover Hebrew natively, so טפסים / תבניות stop falling back to
// a system face. The portal aliases --font-portal-* onto these in globals.css.
const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
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
        </ThemeProvider>
      </body>
    </html>
  );
}
