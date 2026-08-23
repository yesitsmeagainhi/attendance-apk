import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { api, setAuthToken } from "../api/client";

/**
 * Session tokens are plain UUIDs with a one-year lifetime, so they live in
 * SecureStore (Android Keystore) rather than AsyncStorage, which is readable
 * on a rooted device.
 */
const TOKEN_KEY = "attendly.session.token";
const NAME_KEY = "attendly.session.name";
const EMPLOYEE_KEY = "attendly.session.employeeId";
const ROLE_KEY = "attendly.session.role";

/**
 * `role` is whatever the server calls this account — the same string
 * `verify-otp` and `session-check` return. It is kept so the UI can tell an
 * admin apart from an employee; the server still decides what each token is
 * allowed to do, so this is for display and navigation only.
 */
type Session = { token: string; name: string; employeeId: string; role: string };

type AuthValue = {
  session: Session | null;
  /** True until the stored token has been read and validated on cold start. */
  restoring: boolean;
  signIn: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!token) return;

        setAuthToken(token);
        // The server is the authority on whether this token still works. An
        // employee signing in elsewhere invalidates it, since verify-otp drops
        // existing sessions.
        let role = "";
        try {
          const check = await api.sessionCheck();
          if (!check?.valid) throw new Error("invalid");
          role = check.role ?? "";
        } catch {
          await clearStorage();
          setAuthToken(null);
          return;
        }

        const [name, employeeId, storedRole] = await Promise.all([
          SecureStore.getItemAsync(NAME_KEY),
          SecureStore.getItemAsync(EMPLOYEE_KEY),
          SecureStore.getItemAsync(ROLE_KEY),
        ]);
        // session-check is the fresher answer; fall back to what was stored at
        // sign-in if this build of the server does not return a role.
        const effectiveRole = role || storedRole || "";
        // Write it back. The background notification worker has no React tree
        // and reads this key directly, so a role that only ever lived in memory
        // would leave it polling the wrong endpoints forever — silently, since
        // the wrong-role calls just fail and get swallowed.
        if (effectiveRole && effectiveRole !== storedRole) {
          SecureStore.setItemAsync(ROLE_KEY, effectiveRole).catch(() => {});
        }
        setSession({
          token,
          name: name ?? "",
          employeeId: employeeId ?? "",
          role: effectiveRole,
        });
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (s: Session) => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, s.token),
      SecureStore.setItemAsync(NAME_KEY, s.name),
      SecureStore.setItemAsync(EMPLOYEE_KEY, s.employeeId),
      SecureStore.setItemAsync(ROLE_KEY, s.role),
    ]);
    setAuthToken(s.token);
    setSession(s);
  }, []);

  const signOut = useCallback(async () => {
    // Tell the server first, while the token is still valid; a failure here
    // must not strand the user in a signed-in shell.
    try {
      await api.logout();
    } catch {
      // ignore
    }
    await clearStorage();
    setAuthToken(null);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, restoring, signIn, signOut }),
    [session, restoring, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function clearStorage() {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(NAME_KEY),
    SecureStore.deleteItemAsync(EMPLOYEE_KEY),
    SecureStore.deleteItemAsync(ROLE_KEY),
  ]);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
