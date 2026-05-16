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
    <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* --- ADD / EDIT FORM --- */}
      <div 
        className="rounded-[2.5rem] border p-8 md:p-12 backdrop-blur-2xl shadow-2xl relative overflow-hidden"
        style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/[0.03] blur-[100px] -z-10" />
        
        <h2 className="text-2xl font-black text-white mb-10 flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
            <UserPlus size={24} />
          </div>
          <div>
            <span className="block text-xl tracking-tight">{isEditing ? "Modify Personnel Record" : "Register Partner System"}</span>
            <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Satellite Network Enrollment</span>
          </div>
        </h2>

        <form onSubmit={addPhotographer} className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Nickname — internal only */}
          <div className="md:col-span-1">
            <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Internal Identifier</label>
            <input
              type="text"
              name="nickname"
              value={fields.nickname}
              onChange={handleField('nickname')}
              className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white placeholder:text-white/10"
              placeholder="Private Node ID"
            />
          </div>

          {/* Studio Name */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Public Alias (Studio Name)</label>
            <input
              type="text"
              name="name"
              value={fields.name}
              onChange={handleField('name')}
              className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white placeholder:text-white/10"
              placeholder="Brand System Name"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Telemetry Uplink (Phone)</label>
            <input
              type="text"
              name="phone"
              value={fields.phone}
              onChange={handleField('phone')}
              className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white placeholder:text-white/10"
              placeholder="Communication Line"
            />
          </div>

          {/* City */}
          <div>
            <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Geographic Sector (City)</label>
            <input
              type="text"
              name="city"
              value={fields.city}
              onChange={handleField('city')}
              className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white placeholder:text-white/10"
              placeholder="Location Matrix"
            />
          </div>

          {/* Instagram */}
          <div>
            <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Portfolio Sync (IG)</label>
            <div className="relative">
              <input
                type="text"
                name="instagram_url"
                value={fields.instagram_url}
                onChange={handleField('instagram_url')}
                className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-pink-500/30 transition-all font-black text-white/60 placeholder:text-white/10"
                placeholder="Social Data Link"
              />
            </div>
          </div>

          {/* Logo Upload */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Brand Visual Identity (Logo)</label>
            <div className="flex gap-4">
              <input
                type="text"
                name="logo_url"
                value={fields.logo_url}
                onChange={handleField('logo_url')}
                className="flex-1 p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white/60 text-sm placeholder:text-white/10"
                placeholder="Direct Asset URL..."
              />
              <button
                type="button"
                onClick={() => (document.getElementById('p_logo_file') as HTMLInputElement)?.click()}
                className="px-8 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all flex items-center gap-3 shadow-lg shadow-blue-600/20 active:scale-95 border border-blue-500/20"
              >
                <LinkIcon size={16} /> Uplink
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
                  btn.innerText = 'UPLOADING...';
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
                    btn.innerText = 'SUCCESS';
                    setTimeout(() => btn.innerHTML = originalHtml, 2000);
                  } else {
                    btn.innerText = 'FAILED';
                    setTimeout(() => btn.innerHTML = originalHtml, 2000);
                  }
                }}
              />
            </div>
            {fields.logo_url && (
              <div className="mt-6 flex items-center gap-4 p-4 bg-white/[0.02] rounded-[1.5rem] border border-white/[0.08] animate-in zoom-in-95 duration-500">
                <div className="w-14 h-14 rounded-xl bg-white flex items-center justify-center p-2.5 border border-white/10 shadow-2xl">
                  <img src={fields.logo_url} alt="Logo Preview" className="w-full h-full object-contain" />
                </div>
                <div>
                   <p className="text-[10px] font-black text-green-400 uppercase tracking-widest">Asset Synchronization Complete</p>
                   <p className="text-[9px] text-white/20 font-bold uppercase mt-1">Branding vector active</p>
                </div>
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="md:col-span-3 pt-10">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-6 rounded-[2rem] font-black text-sm uppercase tracking-[0.4em] shadow-2xl transition-all duration-500 transform active:scale-[0.98] disabled:opacity-30 flex items-center justify-center gap-4 border ${
                isEditing 
                  ? 'bg-amber-600 text-white border-amber-500/20 shadow-amber-600/20 hover:bg-amber-500' 
                  : 'bg-blue-600 text-white border-blue-500/20 shadow-blue-600/30 hover:bg-blue-500'
              }`}
            >
              {isSubmitting ? (
                <><RefreshCw size={20} className="animate-spin" /> SYNCHRONIZING SYSTEM...</>
              ) : (
                <>
                  <Zap size={20} />
                  {isEditing ? "SAVE RECORD UPDATES" : "INITIALIZE PARTNER ENROLLMENT"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* --- PHOTOGRAPHER LIST WITH SEARCH --- */}
      <div 
        className="rounded-[3rem] border p-8 md:p-12 backdrop-blur-2xl shadow-2xl relative overflow-hidden"
        style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 mb-12 relative z-10">
          <div>
            <h3 className="text-2xl font-black text-white flex items-center gap-4 tracking-tight">
              <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center border border-green-500/20 shadow-lg shadow-green-500/5">
                <Users size={24} className="text-green-400" />
              </div>
              Verified Partners
            </h3>
            <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] mt-3">
              ACTIVE NETWORK NODES: <span className="text-white/60">{photographers.length} SYSTEMS ONLINE</span>
            </p>
          </div>

          <div className="relative w-full lg:w-[450px] group">
            <input
              type="text"
              placeholder="Query by alias, sector or telemetry..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full p-5 pl-14 bg-white/[0.03] border border-white/[0.08] rounded-[2rem] outline-none focus:ring-2 focus:ring-green-500/50 font-black text-white placeholder:text-white/10 transition-all"
            />
            <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-green-400 transition-colors" size={22} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {(searchQuery ? filtered : photographers).map((p, idx) => (
            <div key={p.id} className="p-8 bg-white/[0.01] rounded-[2.5rem] border border-white/[0.05] hover:border-blue-500/20 hover:bg-white/[0.03] transition-all duration-500 group shadow-xl relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-700" style={{ animationDelay: `${idx * 50}ms` }}>
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/[0.01] blur-3xl -z-10 group-hover:bg-blue-600/[0.03] transition-all" />
              
              <div className="flex items-start gap-6 mb-8">
                <div className="w-20 h-20 rounded-[1.5rem] overflow-hidden bg-white flex-shrink-0 group-hover:scale-105 transition-all duration-700 shadow-2xl p-3 border border-white/10">
                  {p.logo_url ? (
                    <img src={p.logo_url} className="w-full h-full object-contain" alt={p.name} />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-black text-3xl shadow-inner">
                      {(p.nickname || p.name || "?").substring(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-2">
                  {p.nickname && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">{p.nickname}</span>
                    </div>
                  )}
                  <p className="font-black text-white text-xl truncate tracking-tight leading-none">{p.name || <span className="text-white/10 italic">Undefined Alias</span>}</p>
                </div>
              </div>

              {/* Details Matrix */}
              <div className="space-y-4 mb-10">
                {p.phone_number && (
                  <div className="flex items-center gap-4 text-[11px] font-black text-white/40 bg-white/[0.02] p-4 rounded-2xl border border-white/[0.05] group-hover:border-white/10 transition-colors">
                    <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center"><Phone size={14} className="text-white/20" /></div>
                    <span className="tracking-widest">{p.phone_number}</span>
                  </div>
                )}
                {p.city && (
                  <div className="flex items-center gap-4 text-[11px] font-black text-white/40 bg-white/[0.02] p-4 rounded-2xl border border-white/[0.05] group-hover:border-white/10 transition-colors">
                    <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center"><MapPin size={14} className="text-white/20" /></div>
                    <span className="tracking-widest uppercase">{p.city}</span>
                  </div>
                )}
                {p.instagram_url && (
                  <a href={p.instagram_url} target="_blank" className="flex items-center gap-4 text-[11px] font-black text-blue-400 bg-blue-500/5 p-4 rounded-2xl border border-blue-500/10 hover:bg-blue-500/10 transition-all">
                    <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center"><LinkIcon size={14} className="text-blue-400" /></div>
                    <span className="truncate uppercase tracking-widest">Digital Portfolio</span>
                  </a>
                )}
              </div>

              {/* System Actions */}
              <div className="flex items-center gap-4 pt-6 border-t border-white/[0.05]">
                <button 
                  onClick={() => onEdit(p)} 
                  className="flex-1 py-3 bg-white/5 rounded-2xl text-white/40 hover:text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/20 border border-white/5 shadow-sm transition-all text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 active:scale-95"
                >
                  <Edit size={16} /> Mod
                </button>
                <button 
                  onClick={() => deletePhotographer(p.id)} 
                  className="flex-1 py-3 bg-white/5 rounded-2xl text-white/40 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 border border-white/5 shadow-sm transition-all text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 active:scale-95"
                >
                  <Trash2 size={16} /> Wipe
                </button>
              </div>
            </div>
          ))}
          
          {searchQuery && filtered.length === 0 && (
            <div className="lg:col-span-3 text-center py-24 bg-white/[0.01] rounded-[3rem] border border-dashed border-white/10 animate-in zoom-in-95 duration-700">
              <Search size={64} className="mx-auto mb-6 text-white/5" />
              <p className="font-black text-white/20 uppercase tracking-[0.4em] text-sm">No matching systems found in sector</p>
              <button onClick={() => setSearchQuery('')} className="mt-6 text-[10px] font-black text-blue-500 uppercase tracking-widest hover:text-blue-400 transition-colors">Reset Query Filter</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
