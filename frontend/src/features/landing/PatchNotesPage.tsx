import { useC, SH1 } from "@/app/shared";
import { PATCH_NOTES, type PatchNote } from "@/features/landing/patchNotes";

function PatchSection({ label, items, color }: { label: string; items?: string[]; color: string }) {
  const C = useC();
  if (!items?.length) return null;
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color, fontFamily: "Roboto" }}>{label}</p>
      <ul className="list-disc pl-5 space-y-1 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function PatchNoteCard({ note }: { note: PatchNote }) {
  const C = useC();
  return (
    <article
      className="relative pl-6 sm:pl-8 pb-10 last:pb-0"
      style={{ borderLeft: `2px solid ${C.outlineVar}` }}
    >
      <div
        className="absolute left-0 top-1 w-3 h-3 rounded-full -translate-x-[7px]"
        style={{ background: C.primary }}
        aria-hidden
      />
      <div className="rounded-2xl border p-5 sm:p-6" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
          <h2 className="text-lg font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            v{note.version}
          </h2>
          <time className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }} dateTime={note.releaseDate}>
            {note.releaseDate}
          </time>
        </div>
        {note.title && (
          <p className="text-sm font-medium mb-4" style={{ color: C.primary, fontFamily: "Roboto" }}>{note.title}</p>
        )}
        <PatchSection label="Added" items={note.sections.added} color={C.primary} />
        <PatchSection label="Improved" items={note.sections.improved} color="#006688" />
        <PatchSection label="Fixed" items={note.sections.fixed} color={C.error} />
      </div>
    </article>
  );
}

function PatchNotesPage() {
  const C = useC();

  return (
    <div className="pt-24 pb-16 px-4 min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto">
        <header className="mb-10">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>Support</p>
          <h1 className="text-3xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Patch Notes</h1>
          <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Version history for the Plantend platform. New releases append to the timeline below.
          </p>
        </header>

        <div>
          {PATCH_NOTES.map(note => (
            <PatchNoteCard key={note.version} note={note} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default PatchNotesPage;
