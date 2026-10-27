import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { userSchema, type User } from "../../shared/users";
import { authClient, authFetch, configureAuthRequest } from "../services/auth";
import { Button } from "../components/shared";
import { queryClient } from "./queryClient";
import { onDataChanged, useLiveUpdates } from "./liveUpdates";

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
  // Cached data belongs to the signed-in user (FLOW-189): drop it whenever
  // the user changes, including sign-out and an expired session.
  useEffect(() => () => queryClient.clear(), [user?.id]);
  // It also depends on what they may see (FLOW-206): when an Admin changes
  // their role or employment type, empty every screen and load it again.
  const shownUser = useRef<User | null>(null);
  useEffect(() => {
    const previous = shownUser.current;
    shownUser.current = user;
    if (
      previous &&
      user &&
      previous.id === user.id &&
      (previous.role !== user.role ||
        previous.employmentType !== user.employmentType)
    )
      void queryClient.resetQueries();
  }, [user]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [client, setClient] = useState<SupabaseClient | null>(null);
  // Open screens follow other users' changes while someone is signed in.
  useLiveUpdates(user ? client : null);
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
        // Another user's change may be to this user's own role or status:
        // re-check the profile whenever open screens refresh (FLOW-206).
        // A refused account is signed out by authFetch; other failures keep
        // the current profile until the next check.
        const stopWatching = onDataChanged(() => {
          const current = revision;
          void authFetch("/api/auth/me")
            .then(async (response) => {
              if (!response.ok) return;
              const profile = userSchema.parse(await response.json());
              if (active && current === revision)
                setUser((shown) =>
                  JSON.stringify(shown) === JSON.stringify(profile)
                    ? shown
                    : profile,
                );
            })
            .catch(() => undefined);
        });
        unsubscribe = () => {
          subscription.data.subscription.unsubscribe();
          stopWatching();
        };
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
    setLoading(true);
    setUser(null);
    setError("");
    const { error: signOutError } = await client!.auth.signOut({
      scope: "local",
    });
    setLoading(false);
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
