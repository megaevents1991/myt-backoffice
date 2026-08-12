"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Sidebar } from "@/components/Sidebar";
import { useToast } from "@/hooks/use-toast";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  // Error state is write-only on purpose - the handler toasts; nothing renders it.
  const [, setError] = useState<Error | null>(null);
  const { toast } = useToast();
  const ignoredResourceErrors = useRef<Set<string>>(new Set());

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !user) {
      console.log("No user found, redirecting to login");
      router.push("/auth/login");
    }
  }, [user, isLoading, router]);

  // Global error + unhandled promise rejection handlers
  useEffect(() => {
    const handleError = (event: Event) => {
      // Runtime JS errors
      if (event instanceof ErrorEvent && event.error) {
        console.error("Dashboard runtime error:", event.error);
        setError(event.error);
        toast({
          variant: "destructive",
          title: "Error",
          description:
            event.error?.message ||
            "An error occurred in the dashboard. Check console for details.",
        });
        return;
      }

      // Resource loading errors (images, scripts, etc.) often don't have an Error object
      const target = event.target as (HTMLElement & { src?: string }) | null;
      if (target) {
        if (target.tagName === "IMG") {
          const img = target as HTMLImageElement;
            // Ignore known external CORS image failures & avoid spamming
            if (img.src.includes("doctorticket.com")) {
              if (!ignoredResourceErrors.current.has(img.src)) {
                console.warn("Ignored image load/CORS issue:", img.src);
                ignoredResourceErrors.current.add(img.src);
              }
              return; // don't surface toast
            }
          // For other images, log once but don't toast
          if (!ignoredResourceErrors.current.has(img.src)) {
            console.warn("Image failed to load:", img.src);
            ignoredResourceErrors.current.add(img.src);
          }
          return;
        }
      }
      // Fallback generic log (no toast to reduce noise)
      console.warn("Unhandled non-error event captured:", event);
    };

    const handleUnhandledRejection = (e: PromiseRejectionEvent) => {
      console.error("Unhandled promise rejection:", e.reason);
      toast({
        variant: "destructive",
        title: "Unexpected error",
        description:
          (e.reason && (e.reason.message || String(e.reason))) ||
          "An asynchronous error occurred.",
      });
    };

    window.addEventListener("error", handleError, true); // capture to catch resource errors reliably
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError, true);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [toast]);

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-lg">Loading dashboard...</span>
      </div>
    );
  }

  // Don't render anything if not authenticated (prevents flash of content)
  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">{children}</div>
    </div>
  );
}
