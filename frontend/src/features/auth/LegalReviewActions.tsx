import { FilledBtn, OutlinedBtn, useC, SH1 } from "@/app/shared";
import type { Page } from "@/app/shared";
import {
  clearSignupLegalReview,
  isSignupLegalReviewActive,
  setSignupAgreedInDraft,
} from "@/features/auth/signupDraft";
import { hashQueryParams, setPageInLocationWithQuery } from "@/shared/routing";

/** Accept / Decline bar — only when opened from Sign-Up registration review. */
export function LegalReviewActions({
  setPage,
  documentLabel,
}: {
  setPage: (p: Page) => void;
  documentLabel: string;
}) {
  const C = useC();
  const fromSignup =
    hashQueryParams().get("from") === "signup" || isSignupLegalReviewActive();

  if (!fromSignup) return null;

  const finish = (accepted: boolean) => {
    setSignupAgreedInDraft(accepted);
    clearSignupLegalReview();
    setPageInLocationWithQuery("signup", {});
    setPage("signup");
  };

  return (
    <div
      className="sticky bottom-0 z-10 -mx-4 sm:mx-0 mt-8 border-t px-4 py-4 sm:rounded-b-2xl"
      style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}
      role="region"
      aria-label={`${documentLabel} registration consent`}
    >
      <p className="text-sm mb-3 text-center sm:text-left" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
        Review complete? Accept to continue registration, or decline to return without agreeing.
      </p>
      <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
        <OutlinedBtn onClick={() => finish(false)} cls="justify-center sm:min-w-[120px]">
          Decline
        </OutlinedBtn>
        <FilledBtn onClick={() => finish(true)} cls="justify-center sm:min-w-[120px]">
          Accept
        </FilledBtn>
      </div>
    </div>
  );
}
