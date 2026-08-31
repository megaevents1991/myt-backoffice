"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Check, Loader2 } from "lucide-react";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { user, login } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");

  // Redirect if user is already logged in. Partners home to /portal - their
  // session cookie is /portal-scoped, so sending them to /dashboard would
  // bounce back here forever (middleware never sees their cookie there).
  useEffect(() => {
    if (user) {
      router.push(
        (PARTNER_ROLES as readonly string[]).includes(user.role)
          ? "/portal"
          : user.role === "forms_operator"
            ? "/forms"
            : "/dashboard"
      );
    }
  }, [user, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      console.log("Submitting login form...");
      const result = await login(email, password);

      if ("user" in result) {
        const home = (PARTNER_ROLES as readonly string[]).includes(
          result.user.role
        )
          ? "/portal"
          : result.user.role === "forms_operator"
            ? "/forms"
            : "/dashboard";
        console.log("Login successful, redirecting to", home);
        toast({
          title: "Login successful",
          description: "Welcome to the backoffice dashboard.",
        });

        // Add a small delay before redirect to ensure cookie is set
        setTimeout(() => {
          router.push(home);
        }, 500);
      } else {
        console.log("Login failed");
        setError(result.error);
        toast({
          variant: "destructive",
          title: "Login failed",
          description: result.error,
        });
      }
    } catch (error) {
      console.error("Login error:", error);
      setError("An unexpected error occurred");
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel - the forest band the portal and customer site already
          wear. Hidden on small screens, where the form is the whole page. */}
      <aside className="brand-aurora relative hidden flex-col justify-between p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-mint font-display text-lg font-bold text-brand-forest">
            M
          </div>
          <div>
            <p className="font-display text-lg font-bold leading-tight text-white">
              MYT Admin
            </p>
            <p className="text-xs uppercase tracking-wider text-white/50">
              Backoffice
            </p>
          </div>
        </div>

        <div className="max-w-md">
          <h2 className="font-display text-3xl font-bold leading-tight text-balance text-white">
            The engine room behind every MYT package.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            Events, flights, hotels and tickets come together here - then the
            customer site sells what you publish.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {[
              "Provider feeds sync themselves overnight",
              "One price chain, from base rate to checkout",
              "Partners, coupons and the product feed in one place",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-mint" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/40">
          Staff access only. Partners sign in at the agent portal.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          {/* Small screens lose the brand panel, so the mark comes along here. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-display text-base font-bold text-primary-foreground">
              M
            </div>
            <span className="font-display text-base font-bold">MYT Admin</span>
          </div>

          <h1 className="font-display text-2xl font-bold tracking-tight">
            Sign in
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Use your staff account to reach the backoffice.
          </p>

          {(urlError || error) && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {error ||
                  (urlError === "no-account"
                    ? "No account for this Google email - contact an admin."
                    : "Google sign-in failed. Try again.")}
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@mega-events.co.il"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => (window.location.href = "/api/auth/google")}
          >
            Continue with Google
          </Button>

          <p className="mt-8 text-center text-xs text-muted-foreground lg:hidden">
            Staff access only. Partners sign in at the agent portal.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
