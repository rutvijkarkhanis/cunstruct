import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

type Mode = "signin" | "signup" | "forgot" | "reset";

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("returnUrl");
  const { user, loading, isStaff, roles } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  // Detect password-recovery token in the URL hash (Supabase puts it there)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setMode("reset");
    }
  }, []);

  useEffect(() => {
    if (!loading && user && mode !== "reset") {
      if (returnUrl) { navigate(returnUrl); return; }
      if (roles.length === 0 && !isStaff) {
        const t = setTimeout(() => navigate(isStaff ? "/ops" : "/my-projects"), 300);
        return () => clearTimeout(t);
      }
      navigate(isStaff ? "/ops" : "/my-projects");
    }
  }, [user, loading, isStaff, roles, returnUrl, navigate, mode]);

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
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/auth",
        });
        if (error) throw error;
        toast.success("Password reset link sent — check your inbox.");
        setMode("signin");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Password updated. You're now signed in.");
        navigate(isStaff ? "/ops" : "/my-projects");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  };

  const title = { signin: "Sign in", signup: "Create account", forgot: "Reset password", reset: "Set new password" }[mode];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:underline">← Back to Cunstruct</Link>
          <h1 className="text-2xl font-bold mt-2">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">Cunstruct Operations Console</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          {mode !== "reset" && (
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          )}
          {(mode === "signin" || mode === "signup" || mode === "reset") && (
            <div>
              <Label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          )}
          {mode === "signin" && (
            <div className="text-right">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setMode("forgot")}
              >
                Forgot password?
              </button>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "…" : { signin: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Set new password" }[mode]}
          </Button>
        </form>

        {(mode === "signin" || mode === "signup") && (
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
        )}

        {mode === "forgot" && (
          <p className="text-sm text-center text-muted-foreground">
            <button type="button" className="text-primary underline" onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          </p>
        )}

        {mode === "signin" && (
          <p className="text-xs text-center text-muted-foreground">
            First user to sign up is auto-promoted to admin.
          </p>
        )}
      </Card>
    </div>
  );
}
