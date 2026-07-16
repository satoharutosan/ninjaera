/** Temporary signup draft while reviewing Terms / Privacy. Cleared after successful register. */

const DRAFT_KEY = "ninja-era-signup-draft";
const REVIEW_KEY = "ninja-era-signup-legal-review";
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export type SignupDraft = {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  agreed: boolean;
  savedAt: number;
};

export function saveSignupDraft(draft: Omit<SignupDraft, "savedAt">) {
  try {
    const payload: SignupDraft = { ...draft, savedAt: Date.now() };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch { /* ignore quota / private mode */ }
}

export function loadSignupDraft(): SignupDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SignupDraft;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      clearSignupDraft();
      return null;
    }
    return {
      email: String(parsed.email || ""),
      username: String(parsed.username || ""),
      password: String(parsed.password || ""),
      confirmPassword: String(parsed.confirmPassword || ""),
      agreed: Boolean(parsed.agreed),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearSignupDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}

/** Marks that Terms/Privacy were opened from Sign-Up (Accept/Decline mode). */
export function beginSignupLegalReview() {
  try {
    sessionStorage.setItem(REVIEW_KEY, "1");
  } catch { /* ignore */ }
}

export function clearSignupLegalReview() {
  try {
    sessionStorage.removeItem(REVIEW_KEY);
  } catch { /* ignore */ }
}

export function isSignupLegalReviewActive(): boolean {
  try {
    if (sessionStorage.getItem(REVIEW_KEY) === "1") return true;
  } catch { /* ignore */ }
  return false;
}

export function setSignupAgreedInDraft(agreed: boolean) {
  const draft = loadSignupDraft();
  if (!draft) {
    saveSignupDraft({
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
      agreed,
    });
    return;
  }
  saveSignupDraft({ ...draft, agreed });
}
