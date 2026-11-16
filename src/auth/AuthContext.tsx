import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { api, ApiError, setAuthToken } from "../api/client";

/**
 * Session tokens are plain UUIDs with a one-year lifetime, so they live in
 * SecureStore (Android Keystore) rather than AsyncStorage, which is readable
 * on a rooted device.
 */
const TOKEN_KEY = "attendly.session.token";
const NAME_KEY = "attendly.session.name";
const EMPLOYEE_KEY = "attendly.session.employeeId";
const SESSION_CHECK_TIMEOUT_MS = 5000;

type Session = { token: string; name: string; employeeId: string };

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
        try {
          // Don't hold the splash on a slow network: past the timeout, treat it
          // like being offline and keep the stored session.
          const check = await Promise.race([
            api.sessionCheck(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new ApiError("timeout", 0)), SESSION_CHECK_TIMEOUT_MS),
            ),
          ]);
          if (!check?.valid) throw new ApiError("invalid", 401);
        } catch (err) {
          // Only clear the session when the server explicitly says the token
          // is invalid (401/403). Network errors (status 0, timeouts, no
          // connectivity) should NOT log the user out — they can retry once
          // they have a connection again.
          const status = err instanceof ApiError ? err.status : 0;
          if (status === 401 || status === 403) {
            await clearStorage();
            setAuthToken(null);
            return;
          }
          // Network/server error — keep the stored session and proceed offline
        }

        const [name, employeeId] = await Promise.all([
          SecureStore.getItemAsync(NAME_KEY),
          SecureStore.getItemAsync(EMPLOYEE_KEY),
        ]);
        setSession({ token, name: name ?? "", employeeId: employeeId ?? "" });
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
  ]);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
