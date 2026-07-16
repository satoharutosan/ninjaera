import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ImageIcon from "@mui/icons-material/Image";
import DeleteIcon from "@mui/icons-material/Delete";
import { useC, SH1, FilledBtn, OutlinedBtn, Field } from "@/app/shared";
import { api, ApiError, type OurStoryContent } from "@/app/api";
import { renderStoryMarkdown } from "@/shared/storyMarkdown";

const EMPTY: OurStoryContent = {
  id: 0,
  slug: "about-our-story",
  title: "Our Story",
  subtitle: "",
  body: "",
  quote: "",
  imageUrl: null,
  status: "published",
  updatedAt: "",
  updatedBy: null,
  publishedAt: null,
};

export function AdminOurStoryEditor() {
  const C = useC();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<OurStoryContent>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"draft" | "published" | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.admin.getOurStory()
      .then((r) => { if (!cancelled) setForm(r.content); })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "Failed to load Our Story"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  const previewUrl = removeImage ? null : (imagePreview || form.imageUrl);

  const save = async (status: "draft" | "published") => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(status);
    try {
      const { content } = await api.admin.saveOurStory({
        title: form.title,
        subtitle: form.subtitle,
        body: form.body,
        quote: form.quote,
        status,
        removeImage: removeImage && !imageFile,
        image: imageFile,
      });
      setForm(content);
      setImageFile(null);
      setImagePreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      setRemoveImage(false);
      if (fileRef.current) fileRef.current.value = "";
      toast.success(status === "published" ? "Our Story published" : "Draft saved");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <p className="text-sm p-6" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Loading Our Story…</p>;
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6 min-h-0">
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Our Story</h2>
          <p className="text-sm mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Edit the About page Our Story section. Markdown: **bold**, *italic*, # headings, - lists, [links](https://…).
          </p>
          {form.updatedAt && (
            <p className="text-[11px] mt-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono, monospace" }}>
              Last updated {new Date(form.updatedAt).toLocaleString()} · {form.status}
            </p>
          )}
        </div>

        <Field label="Title" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
        <Field label="Subtitle (optional)" value={form.subtitle} onChange={(v) => setForm((f) => ({ ...f, subtitle: v }))} />

        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Body</label>
          <textarea
            rows={12}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            className="w-full px-4 py-3 rounded-2xl border text-sm focus:outline-none resize-y min-h-[200px]"
            style={{ borderColor: C.outline, color: C.onSurface, background: C.surfaceVar, fontFamily: "Roboto" }}
            placeholder={"Paragraph one.\n\n## Heading\n\n- Bullet item\n- Another item"}
          />
        </div>

        <Field label="Highlight quote (optional)" value={form.quote} onChange={(v) => setForm((f) => ({ ...f, quote: v }))} />

        <div>
          <p className="text-xs font-medium mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Image (PNG, JPG, WEBP · max 5MB)</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-28 h-20 rounded-xl overflow-hidden border flex items-center justify-center" style={{ borderColor: C.outlineVar, background: C.surfaceVar }}>
              {previewUrl ? (
                <img src={previewUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon style={{ fontSize: 28, color: C.onSurfaceVar }} />
              )}
            </div>
            <OutlinedBtn onClick={() => fileRef.current?.click()}>
              {previewUrl ? "Replace" : "Upload"}
            </OutlinedBtn>
            {previewUrl && (
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  setImagePreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
                  setRemoveImage(true);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-full hover:bg-black/5"
                style={{ color: C.error, fontFamily: "Roboto" }}
              >
                <DeleteIcon style={{ fontSize: 16 }} /> Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                  toast.error("Image must be 5MB or smaller");
                  return;
                }
                setRemoveImage(false);
                setImageFile(file);
                setImagePreview((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return URL.createObjectURL(file);
                });
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <OutlinedBtn
            cls={saving ? "opacity-60 pointer-events-none" : ""}
            onClick={() => void save("draft")}
          >
            {saving === "draft" ? "Saving…" : "Save Draft"}
          </OutlinedBtn>
          <FilledBtn
            cls={saving ? "opacity-60 pointer-events-none" : ""}
            onClick={() => void save("published")}
          >
            {saving === "published" ? "Publishing…" : "Publish"}
          </FilledBtn>
        </div>
      </div>

      <div className="rounded-2xl border p-5 overflow-y-auto ninja-scroll max-h-[80vh]" style={{ borderColor: C.outlineVar, background: C.surface, boxShadow: SH1 }}>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Live preview</p>
        <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>About</p>
        <h2 className="text-3xl font-light mb-2" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>
          {form.title || "Our Story"}
        </h2>
        {form.subtitle.trim() && (
          <p className="text-sm mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{form.subtitle}</p>
        )}
        {previewUrl && (
          <div className="rounded-2xl overflow-hidden mb-4 max-h-56">
            <img src={previewUrl} alt="" className="w-full h-full object-cover max-h-56" />
          </div>
        )}
        <div>{renderStoryMarkdown(form.body, C.onSurfaceVar)}</div>
        {form.quote.trim() && (
          <blockquote className="mt-4 pl-4 border-l-4 italic text-sm" style={{ borderColor: C.primary, color: C.onSurface, fontFamily: "Roboto" }}>
            {form.quote}
          </blockquote>
        )}
      </div>
    </div>
  );
}
