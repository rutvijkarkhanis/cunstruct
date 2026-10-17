import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "contractor" | "site_engineer" | "ops" | "admin";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  /** True once `roles` reflects the current user (or there is no user).
   *  `loading` turns false as soon as the session is known, but roles load
   *  afterwards — so until this is true, `isStaff === false` means "not known
   *  yet", not "not staff". Gate any role-based redirect on this. */
  rolesReady: boolean;
  isStaff: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  roles: [],
  loading: true,
  rolesReady: false,
  isStaff: false,
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesReady, setRolesReady] = useState(false);
  // The user id whose roles are loaded or loading. A token refresh re-fires
  // onAuthStateChange for the same user and changes nothing; a different
  // user resets roles, and a stale response for a previous user is dropped.
  const rolesFor = useRef<string | null>(null);

  useEffect(() => {
    // Synchronous, so it lands in the SAME update as setUser: a newly signed-in
    // user is never seen with the signed-out state's rolesReady === true (or a
    // previous user's roles). Returns whether a fetch is needed.
    const beginRoles = (uid: string): boolean => {
      if (rolesFor.current === uid) return false;
      rolesFor.current = uid;
      setRoles([]);
      setRolesReady(false);
      return true;
    };
    const fetchRoles = async (uid: string) => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      if (rolesFor.current !== uid) return;
      setRoles((data ?? []).map((r: { role: AppRole }) => r.role));
      setRolesReady(true);
    };
    const clearRoles = () => {
      rolesFor.current = null;
      setRoles([]);
      setRolesReady(true);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        const uid = s.user.id;
        // The query itself is deferred: awaiting Supabase inside this callback can deadlock.
        if (beginRoles(uid)) setTimeout(() => fetchRoles(uid), 0);
      } else {
        clearRoles();
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      const uid = data.session?.user?.id;
      if (uid) { if (beginRoles(uid)) fetchRoles(uid); }
      else clearRoles();
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const isStaff = roles.includes("ops") || roles.includes("admin");

  return (
    <Ctx.Provider
      value={{
        user,
        session,
        roles,
        loading,
        rolesReady,
        isStaff,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);
