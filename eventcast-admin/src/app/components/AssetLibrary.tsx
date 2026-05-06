import React, { useState } from "react";
import { Film, Play, Link, Folder, ChevronRight, ArrowLeft, Image as ImageIcon } from "lucide-react";

interface AssetLibraryProps {
  assetLibrary: any[]; // Now an array of { eventId, eventTitle, slug, assets[] }
  getVideoThumbnail: (url: string) => string | null;
  setSelectedAsset: (url: string) => void;
}

export const AssetLibrary: React.FC<AssetLibraryProps> = ({ 
  assetLibrary, 
  getVideoThumbnail, 
  setSelectedAsset 
}) => {
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  const activeFolder = activeFolderId 
    ? assetLibrary.find(f => f.eventId === activeFolderId) 
    : null;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <Folder className="text-blue-600" size={28} /> 
            {activeFolder ? activeFolder.eventTitle : "Asset Library"}
          </h2>
          <p className="text-slate-500 text-sm font-medium mt-1">
            {activeFolder ? `Viewing ${activeFolder.assets.length} assets in this event` : `Organized across ${assetLibrary.length} event folders`}
          </p>
        </div>
        {activeFolder && (
          <button 
            onClick={() => setActiveFolderId(null)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all"
          >
            <ArrowLeft size={18} /> Back to Folders
          </button>
        )}
      </div>

      {!activeFolder ? (
        /* Folder Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {assetLibrary.map((folder) => (
            <button
              key={folder.eventId}
              onClick={() => setActiveFolderId(folder.eventId)}
              className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-blue-200 transition-all text-left group relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-full -mr-8 -mt-8 group-hover:scale-150 transition-transform duration-500" />
              
              <div className="relative z-10">
                <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-200 group-hover:rotate-6 transition-transform">
                  <Folder size={24} />
                </div>
                <h3 className="font-black text-slate-800 text-lg leading-tight mb-2 line-clamp-2">
                  {folder.eventTitle}
                </h3>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2.5 py-1 rounded-full">
                    {folder.assets.length} Assets
                  </span>
                  <ChevronRight size={18} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        /* Inside Folder: Asset Grid View */
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {activeFolder.assets.map((url: string, i: number) => {
            const isVideo = url.toLowerCase().endsWith('.mp4') || url.toLowerCase().endsWith('.mov') || url.includes('/video/upload/');
            const videoThumb = isVideo ? getVideoThumbnail(url) : null;

            return (
              <div 
                key={i} 
                className="aspect-square bg-slate-100 rounded-2xl overflow-hidden border border-slate-200 group relative cursor-zoom-in shadow-sm hover:shadow-md transition-shadow" 
                onClick={() => setSelectedAsset(url)}
              >
                {isVideo ? (
                  <div className="w-full h-full relative">
                    {videoThumb ? (
                      <img src={videoThumb} className="w-full h-full object-cover" alt="Video Thumbnail" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-indigo-50 text-indigo-500 gap-2">
                        <Film size={32} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Video</span>
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-10 h-10 bg-black/40 rounded-full flex items-center justify-center text-white backdrop-blur-sm">
                        <Play size={20} fill="currentColor" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <img src={url} className="w-full h-full object-cover" alt="Asset" />
                )}
                
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      navigator.clipboard.writeText(url); 
                      alert("URL Copied!"); 
                    }} 
                    className="p-3 bg-white text-slate-800 rounded-xl hover:bg-blue-600 hover:text-white transition-all transform scale-90 group-hover:scale-100"
                    title="Copy Image URL"
                  >
                    <Link size={18} />
                  </button>
                  <span className="text-[10px] text-white font-black uppercase tracking-widest">Copy Link</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {assetLibrary.length === 0 && (
        <div className="py-20 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
          <ImageIcon size={48} className="mx-auto text-slate-300 mb-4" />
          <h3 className="text-xl font-bold text-slate-600">No Assets Found</h3>
          <p className="text-slate-400 max-w-xs mx-auto mt-2">Create an event and upload media to see them organized here.</p>
        </div>
      )}
    </div>
  );
};
