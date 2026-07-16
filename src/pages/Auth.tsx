import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("returnUrl");
  const { user, loading, isStaff, roles } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      if (returnUrl) {
        navigate(returnUrl);
        return;
      }
      // wait until roles have resolved at least once before deciding
      if (roles.length === 0 && !isStaff) {
        const t = setTimeout(() => navigate(isStaff ? "/ops" : "/my-projects"), 300);
        return () => clearTimeout(t);
      }
      navigate(isStaff ? "/ops" : "/my-projects");
    }
  }, [user, loading, isStaff, roles, returnUrl, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + (returnUrl || "/ops"),
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your inbox if email confirmation is required.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // redirect handled by effect
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:underline">← Back to Cunstruct</Link>
          <h1 className="text-2xl font-bold mt-2">{mode === "signin" ? "Sign in" : "Create account"}</h1>
          <p className="text-sm text-muted-foreground mt-1">Cunstruct Operations Console</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "..." : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="text-sm text-center text-muted-foreground">
          {mode === "signin" ? "No account?" : "Already have one?"}{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>

        <p className="text-xs text-center text-muted-foreground">
          First user to sign up is auto-promoted to admin.
        </p>
      </Card>
    </div>
  );
}