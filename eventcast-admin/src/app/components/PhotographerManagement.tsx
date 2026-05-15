"use client";

import React from "react";
import { UserPlus, Search, Link as LinkIcon, Edit, Trash2, Phone, MapPin, Tag } from "lucide-react";

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

  return (
    <div className="max-w-6xl mx-auto space-y-12">
      {/* --- ADD / EDIT FORM --- */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 md:p-10">
        <h2 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-3">
          <UserPlus size={28} className="text-blue-600" />
          {isEditing ? "Modify Photographer Details" : "Register New Photographer"}
        </h2>
        <form onSubmit={addPhotographer} className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Nickname — internal only */}
          <div className="md:col-span-1">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              Nickname <span className="normal-case font-normal text-blue-400">(internal only — not shown on page)</span>
            </label>
            <input
              type="text"
              name="nickname"
              value={fields.nickname}
              onChange={handleField('nickname')}
              className="w-full p-4 bg-blue-50 border border-blue-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800"
              placeholder="e.g. Ashok SSV"
            />
          </div>

          {/* Studio Name */}
          <div className="md:col-span-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              Studio Name <span className="normal-case font-normal text-slate-400">(shown on page)</span>
            </label>
            <input
              type="text"
              name="name"
              value={fields.name}
              onChange={handleField('name')}
              className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800"
              placeholder="e.g. SSV Photography"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Contact Phone</label>
            <input
              type="text"
              name="phone"
              value={fields.phone}
              onChange={handleField('phone')}
              className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800"
              placeholder="+91 98765 43210"
            />
          </div>

          {/* City */}
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">City / Location</label>
            <input
              type="text"
              name="city"
              value={fields.city}
              onChange={handleField('city')}
              className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800"
              placeholder="e.g. Hyderabad"
            />
          </div>

          {/* Instagram */}
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Instagram Link</label>
            <input
              type="text"
              name="instagram_url"
              value={fields.instagram_url}
              onChange={handleField('instagram_url')}
              className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium text-slate-600"
              placeholder="https://instagram.com/..."
            />
          </div>

          {/* Logo Upload */}
          <div className="md:col-span-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Logo</label>
            <div className="flex gap-3">
              <input
                type="text"
                name="logo_url"
                value={fields.logo_url}
                onChange={handleField('logo_url')}
                className="flex-1 p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium text-slate-600"
                placeholder="Paste URL or Upload →"
              />
              <button
                type="button"
                onClick={() => (document.getElementById('p_logo_file') as HTMLInputElement)?.click()}
                className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold text-xs uppercase tracking-widest border border-slate-200 transition-all flex items-center gap-2"
              >
                <LinkIcon size={16} /> Upload
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
                  btn.innerText = 'Uploading...';
                  const fd = new FormData();
                  fd.append('file', file);
                  fd.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'eventcast_gallery');
                  const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`, {
                    method: 'POST',
                    body: fd,
                  });
                  const data = await res.json();
                  if (data.secure_url) {
                    // Update React state — not the DOM
                    setFields(prev => ({ ...prev, logo_url: data.secure_url }));
                    btn.innerText = 'DONE!';
                  } else {
                    btn.innerText = 'FAILED';
                  }
                }}
              />
            </div>
            {fields.logo_url && (
              <div className="mt-2">
                <img src={fields.logo_url} alt="Logo Preview" className="h-12 object-contain rounded-lg border border-slate-100 p-1" />
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="md:col-span-3 pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-4 ${isEditing ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded-2xl font-black shadow-xl transition-all disabled:bg-slate-300`}
            >
              {isSubmitting ? "Processing..." : (isEditing ? "Update Photographer Record" : "Add to Credits System")}
            </button>
          </div>
        </form>
      </div>

      {/* --- PHOTOGRAPHER LIST WITH SEARCH --- */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 md:p-10">
        <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-3">
          <Search size={24} className="text-blue-600" /> Professional Partners
          <span className="ml-auto text-sm font-normal text-slate-400">{photographers.length} registered</span>
        </h3>

        {/* Search Bar */}
        <div className="relative mb-8">
          <input
            type="text"
            placeholder="Search by nickname, studio name, phone, or city..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full p-4 pl-12 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-800"
          />
          <Search className="absolute left-4 top-4 text-slate-400" size={20} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(searchQuery ? filtered : photographers).map(p => (
            <div key={p.id} className="p-6 bg-slate-50 rounded-2xl hover:bg-white hover:shadow-xl hover:shadow-slate-100 transition-all border border-transparent hover:border-slate-100 group">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-white border border-slate-100 shadow-sm flex-shrink-0 group-hover:scale-105 transition-transform">
                  {p.logo_url ? (
                    <img src={p.logo_url} className="w-full h-full object-contain p-2" alt={p.name} />
                  ) : (
                    <div className="w-full h-full bg-blue-600 text-white flex items-center justify-center font-black text-xl">
                      {(p.nickname || p.name || "?").substring(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {/* Nickname badge - internal only */}
                  {p.nickname && (
                    <div className="flex items-center gap-1 mb-1">
                      <Tag size={10} className="text-blue-400" />
                      <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">{p.nickname}</span>
                    </div>
                  )}
                  <p className="font-black text-slate-800 truncate leading-tight">{p.name || <span className="text-slate-400 italic">No studio name</span>}</p>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-1 mb-4">
                {p.phone_number && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Phone size={11} /> <span>{p.phone_number}</span>
                  </div>
                )}
                {p.city && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <MapPin size={11} /> <span>{p.city}</span>
                  </div>
                )}
                {p.instagram_url && (
                  <div className="flex items-center gap-2 text-xs text-blue-500">
                    <LinkIcon size={11} />
                    <a href={p.instagram_url} target="_blank" className="truncate hover:underline">Instagram</a>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                <button onClick={() => onEdit(p)} className="flex-1 py-2 bg-white rounded-xl text-slate-600 hover:text-orange-600 hover:bg-orange-50 shadow-sm transition-colors text-xs font-bold flex items-center justify-center gap-1">
                  <Edit size={13} /> Edit
                </button>
                <button onClick={() => deletePhotographer(p.id)} className="flex-1 py-2 bg-white rounded-xl text-slate-600 hover:text-red-600 hover:bg-red-50 shadow-sm transition-colors text-xs font-bold flex items-center justify-center gap-1">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
          {searchQuery && filtered.length === 0 && (
            <div className="md:col-span-3 text-center py-12 text-slate-400">
              <Search size={32} className="mx-auto mb-3 opacity-30" />
              <p className="font-bold">No results for "{searchQuery}"</p>
              <p className="text-sm">Try searching by nickname, phone, or city</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
