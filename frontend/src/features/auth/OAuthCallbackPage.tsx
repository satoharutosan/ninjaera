import { useEffect, useState } from "react";
import { Page, useC } from "@/app/shared";
import { api, ApiError } from "@/app/api";
import type { ApiUser } from "@/app/api";
import { BrandLogo } from "@/shared/BrandLogo";
import { persistAuthSession, clearAuthCredentials, isAuthPersistent } from "@/shared/authStorage";

function OAuthCallbackPage({ setPage, onLogin }: {
  setPage: (p: Page) => void;
  onLogin: (user: ApiUser) => void;
}) {
  const C = useC();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const hash = window.location.hash || "";
      const queryIndex = hash.indexOf("?");
      const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
      const code = params.get("code");
      const legacyToken = params.get("token");
      const oauthError = params.get("error");

      // Clear sensitive params from the address bar immediately
      window.history.replaceState(null, "", "#/oauth-callback");

      if (oauthError) {
        if (!cancelled) {
          setError(oauthError);
          setLoading(false);
        }
        return;
      }

      if (!code && !legacyToken) {
        if (!cancelled) {
          setError("Missing authentication code. Please try again.");
          setLoading(false);
        }
        return;
      }

      try {
        let token: string;
        let user: ApiUser;

        if (code) {
          const exchanged = await api.auth.oauthExchange(code);
          token = exchanged.token;
          user = exchanged.user;
        } else {
          // Legacy fallback for in-flight redirects during deploy; prefer one-time code.
          persistAuthSession(legacyToken!, null, isAuthPersistent());
          const me = await api.auth.me();
          token = legacyToken!;
          user = me.user;
        }

        if (cancelled) return;
        persistAuthSession(token, user, isAuthPersistent());
        onLogin(user);
        window.history.replaceState(null, "", "#/home");
        setPage("home");
      } catch (e) {
        clearAuthCredentials();
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : "Authentication failed. Please try again.");
          setLoading(false);
        }
      }
    };

    run();
    return () => { cancelled = true; };
  }, [onLogin, setPage]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20" style={{ background: C.surfaceVar }}>
      <div className="rounded-3xl p-8 w-full max-w-sm text-center" style={{ background: C.surface, boxShadow: "0 8px 32px rgba(0,0,0,.16)" }}>
        <BrandLogo size={56} elevated className="mx-auto mb-4" priority />
        {loading ? (
          <>
            <div
              className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-4"
              style={{ borderColor: C.outlineVar, borderTopColor: C.primary }}
              role="status"
              aria-label="Signing in"
            />
            <h1 className="text-xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Completing sign-in…
            </h1>
            <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Please wait while we finish authenticating your account.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Sign-in failed
            </h1>
            <p className="text-sm mb-6" style={{ color: C.error, fontFamily: "Roboto" }}>{error}</p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => setPage("login")}
                className="px-4 py-2 rounded-full text-sm font-medium text-white"
                style={{ background: C.primary, fontFamily: "Roboto" }}
              >
                Back to Login
              </button>
              <button
                type="button"
                onClick={() => setPage("signup")}
                className="px-4 py-2 rounded-full text-sm font-medium border"
                style={{ borderColor: C.outline, color: C.onSurface, fontFamily: "Roboto" }}
              >
                Sign Up
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default OAuthCallbackPage;
