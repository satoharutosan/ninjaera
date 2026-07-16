/** Call permission helpers — mirrors server rules. */

export type CallEligibleUser = {
  isTeamMember?: boolean;
  isAdmin?: boolean;
};

/** Team members and admins count as "members" for calling. */
export function isCallMember(u?: CallEligibleUser | null) {
  return !!(u?.isTeamMember || u?.isAdmin);
}

/**
 * Allowed: Member↔Member, Member↔User.
 * Not allowed: User↔User.
 */
export function canPlaceCall(
  self: CallEligibleUser | null | undefined,
  other: CallEligibleUser | null | undefined,
) {
  return isCallMember(self) || isCallMember(other);
}

export const CALL_DENIED_MESSAGE =
  "Voice and video calls are available only when at least one participant is a team member.";
