import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { userSchema, type User } from "../../shared/users";
import { authClient, authFetch, configureAuthRequest } from "../services/auth";
import { Button } from "../components/shared";

export const AuthContext = createContext<{
  user: User;
  signOut: () => Promise<void>;
} | null>(null);
export const useAuth = () => useContext(AuthContext);
const routeKey = "flowbase.return-route";
const saveRoute = () =>
  sessionStorage.setItem(routeKey, window.location.hash || "#/");
const restoreRoute = () => {
  const route = sessionStorage.getItem(routeKey);
  sessionStorage.removeItem(routeKey);
  if (route?.startsWith("#/")) window.location.hash = route;
};

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [client, setClient] = useState<SupabaseClient | null>(null);
  useEffect(() => {
    let active = true;
    let dispose = () => {};
    let unsubscribe = () => {};
    let revision = 0;
    const fail = (message: string) => {
      if (!active) return;
      revision++;
      saveRoute();
      setUser(null);
      setError(message);
      setLoading(false);
    };
    authClient()
      .then(async (auth) => {
        if (!active) return;
        setClient(auth);
        dispose = configureAuthRequest(
          async () => (await auth.auth.getSession()).data.session?.access_token,
          (status) => {
            fail(
              status === 403
                ? "Your account isn't invited or is inactive. Contact your Admin."
                : "Your session expired. Sign in to continue.",
            );
            void auth.auth.signOut({ scope: "local" });
          },
        );
        const loadUser = async () => {
          const current = ++revision;
          const { data } = await auth.auth.getSession();
          if (!data.session) {
            if (active && current === revision) {
              setUser(null);
              setLoading(false);
            }
            return;
          }
          const response = await authFetch("/api/auth/me");
          if (!response.ok) {
            if (active && current === revision)
              fail(
                "Your account isn't invited or is inactive. Contact your Admin.",
              );
            return;
          }
          const profile = userSchema.parse(await response.json());
          if (active && current === revision) {
            setUser(profile);
            setLoading(false);
            setError("");
            restoreRoute();
          }
        };
        const url = new URL(window.location.href);
        const oauthError =
          url.searchParams.get("error_description") ||
          new URLSearchParams(url.hash.slice(1)).get("error_description");
        const code = url.searchParams.get("code");
        const flowId = url.searchParams.get("sb_flow_id");
        if (url.hash.includes("access_token=")) {
          // Supabase's invitation confirmation may return an email session. The
          // app only accepts Google OAuth; discard it and offer Google sign-in.
          window.history.replaceState(
            null,
            "",
            `${url.pathname}${sessionStorage.getItem(routeKey) || "#/"}`,
          );
        }
        if (code || oauthError) {
          // Never leave authorization codes or provider error payloads in history.
          window.history.replaceState(
            null,
            "",
            `${url.pathname}${sessionStorage.getItem(routeKey) || "#/"}`,
          );
          if (oauthError) {
            fail(
              "This account isn't invited. Contact your Admin, then sign in with Google.",
            );
            return;
          }
          const { error: exchangeError } =
            await auth.auth.exchangeCodeForSession(
              code!,
              flowId ? { flowId } : undefined,
            );
          if (exchangeError) {
            fail(
              "Sign-in could not be completed. Please sign in with Google again.",
            );
            return;
          }
        }
        const subscription = auth.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT" && active) {
            revision++;
            saveRoute();
            setUser(null);
            setLoading(false);
            setError(
              (current) =>
                current || "Your session ended. Sign in to continue.",
            );
          } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
            // Do not await SDK methods inside its auth-state lock.
            window.setTimeout(() => {
              if (active)
                void loadUser().catch(() =>
                  fail("Unable to verify your account. Please retry."),
                );
            }, 0);
          }
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
        await loadUser();
      })
      .catch((err: unknown) =>
        fail(err instanceof Error ? err.message : "Unable to sign in."),
      );
    return () => {
      active = false;
      dispose();
      unsubscribe();
    };
  }, []);
  const signOut = async () => {
    saveRoute();
    setUser(null);
    setError("");
    const { error: signOutError } = await client!.auth.signOut({
      scope: "local",
    });
    if (signOutError)
      setError("Sign-out could not be completed. Please retry.");
  };
  if (loading) return <p role="status">Checking your session…</p>;
  if (user)
    return (
      <AuthContext.Provider value={{ user, signOut }}>
        {children}
      </AuthContext.Provider>
    );
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Sign in to Flowbase</h1>
        <p>Use the Google account invited by your Admin.</p>
        {error && <p role="alert">{error}</p>}
        <Button
          onClick={async () => {
            try {
              saveRoute();
              setError("");
              const auth = client ?? (await authClient());
              const { error: loginError } = await auth.auth.signInWithOAuth({
                provider: "google",
                options: {
                  redirectTo: `${window.location.origin}${window.location.pathname}`,
                },
              });
              if (loginError)
                setError("Sign-in could not be started. Please retry.");
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Unable to sign in.",
              );
            }
          }}
        >
          Continue with Google
        </Button>
      </section>
    </main>
  );
}
