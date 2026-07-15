/** Landing / in-page section anchors */
export const SECTION_IDS = {
  features: "ne-features",
  download: "ne-download",
} as const;

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];

/** Smooth-scroll to a section that is already mounted. */
export function scrollToSection(sectionId: string, behavior: ScrollBehavior = "smooth") {
  const el = document.getElementById(sectionId);
  if (!el) return false;
  el.scrollIntoView({ behavior, block: "start" });
  return true;
}

/**
 * After navigating to home, wait for the section to mount then scroll.
 * Retries briefly so route transitions stay reliable.
 */
export function scrollToSectionWhenReady(sectionId: string, behavior: ScrollBehavior = "smooth") {
  let attempts = 0;
  const maxAttempts = 40;
  const tryScroll = () => {
    if (scrollToSection(sectionId, behavior)) return;
    attempts += 1;
    if (attempts < maxAttempts) requestAnimationFrame(tryScroll);
  };
  requestAnimationFrame(tryScroll);
}
