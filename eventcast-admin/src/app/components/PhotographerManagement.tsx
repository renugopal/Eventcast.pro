"use client";

import React from "react";
import { UserPlus, Search, Link as LinkIcon, Edit, Trash2, Phone, MapPin, RefreshCw, Zap, Users } from "lucide-react";

interface PhotographerManagementProps {
  photographers: any[];
  isSubmitting: boolean;
  addPhotographer: (e: React.FormEvent) => void;
  deletePhotographer: (id: string) => void;
  onEdit: (pg: any) => void;
  isEditing: boolean;
  /** Populated by the parent when editing an existing record; null when adding a new one. */
  editingPhotographer?: any | null;
}

const EMPTY_FIELDS = { nickname: '', name: '', phone: '', city: '', instagram_url: '', logo_url: '' };

export const PhotographerManagement: React.FC<PhotographerManagementProps> = ({
  photographers,
  isSubmitting,
  addPhotographer,
  deletePhotographer,
  onEdit,
  isEditing,
  editingPhotographer,
}) => {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [fields, setFields] = React.useState(EMPTY_FIELDS);

  // Populate controlled form fields whenever the parent passes a different record to edit
  React.useEffect(() => {
    if (editingPhotographer) {
      setFields({
        nickname: editingPhotographer.nickname || '',
        name: editingPhotographer.name || '',
        phone: editingPhotographer.phone_number || '',
        city: editingPhotographer.city || '',
        instagram_url: editingPhotographer.instagram_url || '',
        logo_url: editingPhotographer.logo_url || '',
      });
    } else {
      setFields(EMPTY_FIELDS);
    }
  }, [editingPhotographer]);

  const handleField = (key: keyof typeof EMPTY_FIELDS) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields(prev => ({ ...prev, [key]: e.target.value }));

  const filtered = photographers.filter(p => {
    const q = searchQuery.toLowerCase();
    return (
      (p.nickname || "").toLowerCase().includes(q) ||
      (p.name || "").toLowerCase().includes(q) ||
      (p.phone_number || "").toLowerCase().includes(q) ||
      (p.city || "").toLowerCase().includes(q)
    );
  });

  const list = searchQuery ? filtered : photographers;

  return (
    <div className="w-full space-y-8 pb-12 ec-animate-in">
      {/* --- ADD / EDIT FORM --- */}
      <div className="ec-card">
        <div className="flex items-center gap-4 mb-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--primary-50)", color: "var(--primary)", border: "2px solid var(--primary-100)" }}
          >
            <UserPlus size={24} />
          </div>
          <div>
            <h2 className="ec-page-title" style={{ fontSize: "24px" }}>
              {isEditing ? "Modify Personnel Record" : "Register Partner System"}
            </h2>
            <p className="ec-section-sub">Satellite network enrollment</p>
          </div>
        </div>

        <form onSubmit={addPhotographer} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <label className="ec-label" htmlFor="pg-nickname">Internal identifier</label>
            <input
              id="pg-nickname"
              type="text"
              name="nickname"
              value={fields.nickname}
              onChange={handleField('nickname')}
              className="ec-input"
              placeholder="Username"
            />
          </div>

          <div className="md:col-span-2">
            <label className="ec-label" htmlFor="pg-name">Public alias (studio name)</label>
            <input
              id="pg-name"
              type="text"
              name="name"
              value={fields.name}
              onChange={handleField('name')}
              className="ec-input"
              placeholder="Brand system name"
            />
          </div>

          <div>
            <label className="ec-label" htmlFor="pg-phone">Phone number</label>
            <input
              id="pg-phone"
              type="text"
              name="phone"
              value={fields.phone}
              onChange={handleField('phone')}
              className="ec-input"
              placeholder="Communication line"
            />
          </div>

          <div>
            <label className="ec-label" htmlFor="pg-city">City</label>
            <input
              id="pg-city"
              type="text"
              name="city"
              value={fields.city}
              onChange={handleField('city')}
              className="ec-input"
              placeholder="City"
            />
          </div>

          <div>
            <label className="ec-label" htmlFor="pg-instagram">Portfolio sync (IG)</label>
            <input
              id="pg-instagram"
              type="text"
              name="instagram_url"
              value={fields.instagram_url}
              onChange={handleField('instagram_url')}
              className="ec-input"
              placeholder="Social data link"
            />
          </div>

          <div className="md:col-span-2">
            <label className="ec-label" htmlFor="pg-logo-url">Brand visual identity (logo)</label>
            <div className="flex flex-wrap gap-3">
              <input
                id="pg-logo-url"
                type="text"
                name="logo_url"
                value={fields.logo_url}
                onChange={handleField('logo_url')}
                className="ec-input flex-1 w-full min-w-0"
                placeholder="Direct asset URL…"
              />
              <button
                type="button"
                onClick={() => (document.getElementById('p_logo_file') as HTMLInputElement)?.click()}
                className="ec-btn ec-btn-secondary shrink-0"
              >
                <LinkIcon size={16} /> Profile link
              </button>
              <input
                type="file"
                id="p_logo_file"
                className="hidden"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const btn = e.target.previousElementSibling as HTMLButtonElement;
                  const originalHtml = btn.innerHTML;
                  btn.innerText = 'Uploading…';
                  const fd = new FormData();
                  fd.append('file', file);
                  fd.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'eventcast_gallery');
                  const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`, {
                    method: 'POST',
                    body: fd,
                  });
                  const data = await res.json();
                  if (data.secure_url) {
                    setFields(prev => ({ ...prev, logo_url: data.secure_url }));
                    btn.innerText = 'Success';
                    setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
                  } else {
                    btn.innerText = 'Failed';
                    setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
                  }
                }}
              />
            </div>
            {fields.logo_url && (
              <div
                className="ec-panel mt-4 flex items-center gap-4 animate-in zoom-in-95 duration-300"
                style={{ padding: "12px 16px" }}
              >
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center p-2 shrink-0"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  <img src={fields.logo_url} alt="Logo preview" className="w-full h-full object-contain" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--success)" }}>
                    Asset synchronization complete
                  </p>
                  <p className="ec-section-sub" style={{ marginTop: 2 }}>Branding vector active</p>
                </div>
              </div>
            )}
          </div>

          <div className="md:col-span-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`ec-btn ec-btn-lg w-full text-white disabled:opacity-40 ${
                isEditing ? "ec-btn-amber" : "ec-btn-primary"
              }`}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={20} className="animate-spin" />
                  Synchronizing system…
                </>
              ) : (
                <>
                  <Zap size={20} />
                  {isEditing ? "Save record updates" : "Initialize partner enrollment"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* --- PHOTOGRAPHER LIST WITH SEARCH --- */}
      <div className="ec-card">
        <div className="ec-section-header gap-6 mb-8">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--success-50)", color: "var(--success)", border: "2px solid #BBF7D0" }}
            >
              <Users size={24} />
            </div>
            <div>
              <h3 className="ec-page-title" style={{ fontSize: "24px" }}>Verified partners</h3>
              <p className="ec-section-sub">
                Total photographers:{" "}
                <span style={{ color: "var(--foreground)", fontWeight: 700 }}>{photographers.length} active</span>
              </p>
            </div>
          </div>

          <div className="relative w-full lg:w-[400px]">
            <input
              type="text"
              placeholder="Search by name, city or phone…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="ec-input pl-11 w-full"
            />
            <Search
              size={18}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "var(--text-tertiary)" }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {list.map((p) => (
            <div key={p.id} className="ec-card ec-card-sm flex flex-col">
              <div className="flex items-start gap-4 mb-5">
                <div
                  className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center p-2"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  {p.logo_url ? (
                    <img src={p.logo_url} className="w-full h-full object-contain" alt={p.name} />
                  ) : (
                    <div
                      className="w-full h-full rounded-lg flex items-center justify-center text-white font-bold text-2xl"
                      style={{ background: "linear-gradient(135deg, var(--primary), #6366f1)" }}
                    >
                      {(p.nickname || p.name || "?").substring(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {p.nickname && (
                    <span
                      className="inline-block text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full mb-2"
                      style={{ background: "var(--primary-50)", color: "var(--primary)", border: "1px solid var(--primary-100)" }}
                    >
                      {p.nickname}
                    </span>
                  )}
                  <p className="font-bold text-lg truncate" style={{ color: "var(--foreground)" }}>
                    {p.name || <span className="italic" style={{ color: "var(--text-tertiary)" }}>Undefined alias</span>}
                  </p>
                </div>
              </div>

              <div className="space-y-2 mb-5 flex-1">
                {p.phone_number && (
                  <div className="ec-panel flex items-center gap-3 text-sm" style={{ padding: "10px 12px" }}>
                    <Phone size={14} style={{ color: "var(--text-tertiary)" }} />
                    <span style={{ color: "var(--text-secondary)" }}>{p.phone_number}</span>
                  </div>
                )}
                {p.city && (
                  <div className="ec-panel flex items-center gap-3 text-sm" style={{ padding: "10px 12px" }}>
                    <MapPin size={14} style={{ color: "var(--text-tertiary)" }} />
                    <span className="uppercase" style={{ color: "var(--text-secondary)" }}>{p.city}</span>
                  </div>
                )}
                {p.instagram_url && (
                  <a
                    href={p.instagram_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ec-panel flex items-center gap-3 text-sm transition-colors hover:border-[var(--primary)]"
                    style={{ padding: "10px 12px", color: "var(--primary)" }}
                  >
                    <LinkIcon size={14} />
                    <span className="truncate font-semibold">Digital portfolio</span>
                  </a>
                )}
              </div>

              <div
                className="flex items-center gap-3 pt-4 mt-auto"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              >
                <button
                  type="button"
                  onClick={() => onEdit(p)}
                  className="ec-btn ec-btn-secondary ec-btn-sm flex-1"
                >
                  <Edit size={16} /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => deletePhotographer(p.id)}
                  className="ec-btn ec-btn-danger ec-btn-sm flex-1"
                >
                  <Trash2 size={16} /> Delete
                </button>
              </div>
            </div>
          ))}

          {searchQuery && filtered.length === 0 && (
            <div
              className="lg:col-span-3 ec-card text-center animate-in zoom-in-95 duration-300"
              style={{ padding: "48px 24px", borderStyle: "dashed" }}
            >
              <Search size={48} className="mx-auto mb-4 opacity-30" style={{ color: "var(--text-tertiary)" }} />
              <p className="font-semibold" style={{ color: "var(--text-secondary)" }}>
                No matching partners found
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="ec-btn ec-btn-secondary ec-btn-sm mt-4"
              >
                Reset search
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
