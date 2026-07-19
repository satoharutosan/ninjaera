import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import { Contact, ColorTheme, ChatAvatar } from "@/app/shared";

export function ConversationDetailsBody({
  sel,
  C,
  presenceColor,
  presenceLabel,
}: {
  sel: Contact;
  C: ColorTheme;
  presenceColor: (c: Contact) => string;
  presenceLabel: (c: Contact) => string;
}) {
  const deleted = !!sel.isDeleted || sel.name === "Deleted User";

  const rows = deleted
    ? ([["Status", "Account deleted"]] as [string, string][])
    : (sel.type === "dm"
      ? ([
          ["Membership", sel.isTeamMember ? "Team Member" : "Member"],
          sel.rank ? ["Rank", sel.rank] : null,
          sel.village ? ["Village", sel.village] : null,
          sel.clan ? ["Clan", sel.clan] : null,
          sel.level != null ? ["Level", String(sel.level)] : null,
          sel.memberSince ? ["Joined", sel.memberSince] : null,
          sel.country ? ["Country", sel.country] : null,
        ] as ([string, string] | null)[]).filter(Boolean) as [string, string][]
      : ([
          ["Type", "Channel"],
          sel.bio ? ["About", sel.bio.slice(0, 80) + (sel.bio.length > 80 ? "…" : "")] : null,
        ] as ([string, string] | null)[]).filter(Boolean) as [string, string][]);

  return (
    <>
      <div className="text-center mb-5">
        <div className="relative inline-block mb-3">
          {sel.type === "channel" ? (
            <ChatAvatar name={sel.name} avatarUrl={sel.avatarUrl} size={80} channel className="mx-auto" />
          ) : (
            <ChatAvatar name={sel.name} avatarUrl={sel.avatarUrl} size={80} className="mx-auto" deleted={deleted} />
          )}
          {sel.type === "dm" && !deleted && (
            <FiberManualRecordIcon style={{ fontSize: 14, color: presenceColor(sel), position: "absolute", bottom: 2, right: 2 }} />
          )}
        </div>
        <h3 className="font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
          {deleted ? "Deleted User" : sel.name}
        </h3>
        <span
          className="text-xs font-medium"
          style={{ color: sel.type === "channel" ? C.primary : (deleted ? C.onSurfaceVar : presenceColor(sel)), fontFamily: "Roboto" }}
        >
          {deleted ? "Account no longer available" : presenceLabel(sel)}
        </span>
        {sel.type === "dm" && !deleted && (sel.mood || "").trim() ? (
          <p className="text-xs mt-2 italic leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            {(sel.mood || "").trim()}
          </p>
        ) : null}
        {!deleted && sel.bio ? (
          <p className="text-xs mt-3 leading-relaxed text-left" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{sel.bio}</p>
        ) : null}
        {deleted ? (
          <p className="text-xs mt-3 leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            This account was deleted. You can still view past messages in this conversation.
          </p>
        ) : null}
      </div>
      <div className="space-y-3 text-sm border-t pt-4" style={{ borderColor: C.outlineVar }}>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <span className="shrink-0" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{k}</span>
            <span className="font-medium text-right" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{v}</span>
          </div>
        ))}
        {sel.type === "dm" && !deleted && !sel.village && !sel.memberSince && !sel.rank && (
          <p className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>No additional profile details available.</p>
        )}
      </div>
    </>
  );
}
