"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import type { SessionUser } from "@/types/auth.types";

type User = SessionUser;

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  /** true on success; on failure returns the server's error message (or a
   *  generic one) so the login page can distinguish rate-limit from bad creds. */
  login: (email: string, password: string) => Promise<true | { error: string }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: async () => ({ error: "Auth not ready" }),
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { toast } = useToast();

  // Check for existing session on client-side
  useEffect(() => {
    // One fetch attempt. Returns "retry" ONLY for transient failures (network
    // throw / 5xx) — a definitive { user: null } answer must NOT be retried.
    const attempt = async (): Promise<"retry" | User | null> => {
      try {
        // Add cache busting to prevent stale responses
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/auth/session?t=${timestamp}`, {
          method: "GET",
          credentials: "include",
          headers: {
            "Cache-Control": "no-cache",
          },
        });
        if (response.ok) {
          const data = await response.json();
          return data.user ?? null;
        }
        return response.status >= 500 ? "retry" : null;
      } catch {
        return "retry";
      }
    };

    const checkSession = async () => {
      // A single transient blip here used to strand a logged-in user (user
      // stays null while the cookie is valid → redirect ping-pong between
      // /dashboard and /auth/login). Retry once before giving up.
      let result = await attempt();
      if (result === "retry") {
        await new Promise((r) => setTimeout(r, 1500));
        result = await attempt();
      }
      if (result !== "retry" && result) setUser(result);
      setIsLoading(false);
    };

    checkSession();
  }, []);

  const login = async (
    email: string,
    password: string
  ): Promise<true | { error: string }> => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.user) {
        setUser(data.user);
        return true;
      }

      // Pass the server's message through (429 "wait a minute" vs 401 invalid).
      return { error: data.error || "Invalid email or password" };
    } catch {
      return { error: "Network error — check your connection and try again" };
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });

      setUser(null);
      router.push("/auth/login");
    } catch (error) {
      console.error("Logout error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to logout",
      });
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
