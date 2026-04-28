"use client";

import React from "react";
import { UserPlus, Search, Link as LinkIcon } from "lucide-react";

interface PhotographerManagementProps {
  photographers: any[];
  isSubmitting: boolean;
  addPhotographer: (e: React.FormEvent) => void;
}

export const PhotographerManagement: React.FC<PhotographerManagementProps> = ({
  photographers,
  isSubmitting,
  addPhotographer
}) => {
  return (
    <div className="max-w-6xl mx-auto space-y-12">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-10">
        <h2 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-3">
          <UserPlus size={28} className="text-blue-600" /> Register New Photographer
        </h2>
        <form onSubmit={addPhotographer} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Studio Name</label>
            <input type="text" name="name" required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" placeholder="e.g. Uma Studio" />
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Contact Phone</label>
            <input type="text" name="phone" required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" placeholder="+91 98765 43210" />
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">City</label>
            <input type="text" name="city" required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" placeholder="e.g. Hyderabad" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Logo</label>
            <div className="flex gap-3">
              <input type="text" name="logo_url" id="photographer_logo_url" className="flex-1 p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium text-slate-600" placeholder="Paste URL or Upload ->" />
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
                  if (file) {
                    const btn = e.target.previousElementSibling as HTMLButtonElement;
                    const input = document.getElementById('photographer_logo_url') as HTMLInputElement;
                    btn.innerText = "UPloading...";
                    
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'eventcast_gallery'); 

                    const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`, {
                      method: 'POST',
                      body: formData
                    });
                    const data = await res.json();
                    if (data.secure_url) {
                      input.value = data.secure_url;
                      btn.innerText = "DONE!";
                    } else {
                      btn.innerText = "FAILED";
                    }
                  }
                }}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Instagram Link</label>
            <input type="text" name="instagram_url" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium text-slate-600" placeholder="https://instagram.com/..." />
          </div>
          <div className="md:col-span-3 pt-4">
            <button type="submit" disabled={isSubmitting} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all disabled:bg-slate-300">
              {isSubmitting ? "Processing..." : "Add to Credits System"}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-10">
        <h3 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-3">
          <Search size={24} className="text-blue-600" /> Professional Partners
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {photographers.map(p => (
            <div key={p.id} className="p-6 bg-slate-50 rounded-2xl flex items-center gap-5 hover:bg-white hover:shadow-xl hover:shadow-slate-100 transition-all border border-transparent hover:border-slate-100 group">
              <div className="w-16 h-16 rounded-2xl overflow-hidden bg-white border border-slate-100 shadow-sm flex-shrink-0 group-hover:scale-105 transition-transform">
                {p.logo_url ? (
                  <img src={p.logo_url} className="w-full h-full object-contain p-2" alt={p.name} />
                ) : (
                  <div className="w-full h-full bg-blue-600 text-white flex items-center justify-center font-black text-xl">{p.name.substring(0, 1).toUpperCase()}</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-slate-800 truncate leading-tight">{p.name}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{p.city} • {p.phone_number}</p>
              </div>
              {p.instagram_url && (
                <a href={p.instagram_url} target="_blank" className="p-2 bg-white rounded-xl text-slate-400 hover:text-blue-600 shadow-sm transition-colors">
                  <LinkIcon size={16} />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
