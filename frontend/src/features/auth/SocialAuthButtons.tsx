import type { ReactNode } from "react";
import { useState } from "react";
import { useC } from "@/app/shared";
import { setAuthPersistent } from "@/shared/authStorage";

export type SocialProvider = "google" | "github" | "discord";

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l.1.1 6.3 5.3C39.2 36.3 44 31 44 24c0-1.3-.1-2.7-.4-3.9z" />
    </svg>
  );
}

/** Official GitHub mark (Octocat silhouette) — monochrome for UI consistency. */
function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 98 96" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      />
    </svg>
  );
}

function DiscordIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#5865F2"
        d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.3 18.3 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.7 19.7 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14 14 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.371-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.245.198.372.291a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.8 19.8 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
      />
    </svg>
  );
}

const PROVIDERS: {
  id: SocialProvider;
  label: string;
  icon: (props: { size?: number }) => ReactNode;
}[] = [
  { id: "google", label: "Google", icon: GoogleIcon },
  { id: "github", label: "GitHub", icon: GitHubIcon },
  { id: "discord", label: "Discord", icon: DiscordIcon },
];

export function startOAuth(provider: SocialProvider) {
  window.location.assign(`/api/auth/oauth/${provider}`);
}

export function SocialAuthButtons({
  disabled = false,
  onError,
  staySignedIn,
}: {
  disabled?: boolean;
  onError?: (message: string) => void;
  /** When set, stores Stay-signed-in preference before OAuth redirect. */
  staySignedIn?: boolean;
}) {
  const C = useC();
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const busy = disabled || pending !== null;

  const handleClick = (provider: SocialProvider) => {
    if (busy) {
      onError?.("Please wait for the current request to finish.");
      return;
    }
    if (typeof staySignedIn === "boolean") setAuthPersistent(staySignedIn);
    setPending(provider);
    startOAuth(provider);
  };

  return (
    <div className="grid grid-cols-3 gap-3 mb-6" aria-busy={busy}>
      {PROVIDERS.map((p) => {
        const Icon = p.icon;
        const isPending = pending === p.id;
        return (
          <button
            key={p.id}
            type="button"
            disabled={busy}
            onClick={() => handleClick(p.id)}
            aria-label={`Continue with ${p.label}`}
            title={`Continue with ${p.label}`}
            className="flex items-center justify-center gap-1.5 py-2.5 h-[42px] rounded-full border text-xs font-medium transition-colors hover:bg-[#6750A4]/4 disabled:opacity-50 disabled:pointer-events-none"
            style={{ borderColor: C.outlineVar, fontFamily: "Roboto", color: C.onSurfaceVar }}
          >
            {isPending ? (
              <span
                className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: C.outlineVar, borderTopColor: C.primary }}
                role="status"
                aria-label={`Connecting to ${p.label}`}
              />
            ) : (
              <Icon size={18} />
            )}
            <span>{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
