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
    <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-4">
            <div className="w-12 h-12 rounded-[1.25rem] bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
              <Folder className="text-blue-400" size={24} /> 
            </div>
            <div className="flex flex-col">
              <span>{activeFolder ? activeFolder.eventTitle : "Infrastructure Library"}</span>
              <span className="text-[10px] text-white/30 font-black uppercase tracking-[0.2em] mt-1">
                {activeFolder ? `Ingested Data Objects: ${activeFolder.assets.length}` : `Digital Workspace: ${assetLibrary.length} Active Nodes`}
              </span>
            </div>
          </h2>
        </div>
        {activeFolder && (
          <button 
            onClick={() => setActiveFolderId(null)}
            className="flex items-center gap-3 px-6 py-3 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-2xl font-black text-[10px] uppercase tracking-widest border border-white/10 transition-all shadow-xl group"
          >
            <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back to Workspace
          </button>
        )}
      </div>

      {!activeFolder ? (
        /* Folder Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {assetLibrary.map((folder) => (
            <button
              key={folder.eventId}
              onClick={() => setActiveFolderId(folder.eventId)}
              className="bg-white/[0.03] p-8 rounded-[2rem] border border-white/[0.08] backdrop-blur-md shadow-2xl hover:shadow-blue-500/5 hover:border-blue-500/30 transition-all duration-500 text-left group relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -mr-12 -mt-12 group-hover:scale-150 transition-transform duration-700 blur-2xl" />
              
              <div className="relative z-10">
                <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-blue-500/20 group-hover:rotate-6 transition-all duration-500">
                  <Folder size={28} />
                </div>
                <h3 className="font-black text-white text-lg leading-tight mb-3 line-clamp-2 tracking-tight group-hover:text-blue-400 transition-colors">
                  {folder.eventTitle}
                </h3>
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/5">
                  <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                    {folder.assets.length} Data Blocks
                  </span>
                  <ChevronRight size={18} className="text-white/20 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        /* Inside Folder: Asset Grid View */
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
          {activeFolder.assets.map((url: string, i: number) => {
            const isVideo = url.toLowerCase().endsWith('.mp4') || url.toLowerCase().endsWith('.mov') || url.includes('/video/upload/');
            const videoThumb = isVideo ? getVideoThumbnail(url) : null;

            return (
              <div 
                key={i} 
                className="aspect-square bg-white/[0.03] rounded-[1.5rem] overflow-hidden border border-white/5 group relative cursor-zoom-in shadow-xl hover:border-blue-500/40 hover:shadow-blue-500/10 transition-all duration-300" 
                onClick={() => setSelectedAsset(url)}
              >
                {isVideo ? (
                  <div className="w-full h-full relative">
                    {videoThumb ? (
                      <img src={videoThumb} className="w-full h-full object-cover" alt="Video Thumbnail" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-indigo-500/5 text-indigo-400 gap-3">
                        <Film size={36} className="opacity-40" />
                        <span className="text-[9px] font-black uppercase tracking-widest">Video Stream</span>
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/0 transition-colors">
                      <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-white backdrop-blur-md border border-white/20 shadow-2xl transform group-hover:scale-110 transition-transform">
                        <Play size={20} fill="currentColor" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <img src={url} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt="Asset" />
                )}
                
                <div className="absolute inset-0 bg-slate-900/80 opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col items-center justify-center gap-4 backdrop-blur-sm">
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      navigator.clipboard.writeText(url); 
                      alert("Asset URL synchronized to clipboard!"); 
                    }} 
                    className="p-4 bg-white/10 text-white rounded-[1.25rem] hover:bg-blue-600 border border-white/10 transition-all transform scale-90 group-hover:scale-100 shadow-2xl"
                    title="Copy Image URL"
                  >
                    <Link size={20} />
                  </button>
                  <span className="text-[9px] text-white/60 font-black uppercase tracking-[0.2em]">Synchronize Link</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {assetLibrary.length === 0 && (
        <div className="py-24 text-center bg-white/[0.02] rounded-[3rem] border border-dashed border-white/10 backdrop-blur-sm">
          <div className="w-20 h-20 bg-white/5 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-white/5">
            <ImageIcon size={32} className="text-white/20" />
          </div>
          <h3 className="text-2xl font-black text-white/60 tracking-tight">Ecosystem Empty</h3>
          <p className="text-white/20 font-bold uppercase tracking-widest text-[10px] max-w-xs mx-auto mt-3 leading-relaxed">
            Initialize an event and upload media assets to populate your infrastructure library.
          </p>
        </div>
      )}
    </div>
  );
};
