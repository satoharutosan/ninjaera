# Auth

Login, signup, OAuth callback, and social auth buttons.

## Entry points

- `LoginPage.tsx` / `SignUpPage.tsx` / `OAuthCallbackPage.tsx`
- `SocialAuthButtons.tsx` — Discord/Google entry

Session tokens and `api.auth.*` live in `@/app/api`; the shell (`App.tsx`) owns the authenticated user.
