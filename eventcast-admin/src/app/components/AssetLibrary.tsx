"use client";

import React from "react";
import { Film, Play, Link } from "lucide-react";

interface AssetLibraryProps {
  assetLibrary: any[];
  getVideoThumbnail: (url: string) => string | null;
  setSelectedAsset: (url: string) => void;
}

export const AssetLibrary: React.FC<AssetLibraryProps> = ({ 
  assetLibrary, 
  getVideoThumbnail, 
  setSelectedAsset 
}) => {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-slate-800">Asset Library</h2>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {assetLibrary.map((item, i) => {
          const url = typeof item === 'string' ? item : item?.url || item?.secure_url || '';
          if (!url) return null;
          const isVideo = url.toLowerCase().endsWith('.mp4') || url.toLowerCase().endsWith('.mov') || url.includes('/video/upload/');
          const videoThumb = isVideo ? getVideoThumbnail(url) : null;

          return (
            <div 
              key={i} 
              className="aspect-square bg-slate-100 rounded-xl overflow-hidden border border-slate-200 group relative cursor-zoom-in" 
              onClick={() => setSelectedAsset(url)}
            >
              {isVideo ? (
                <div className="w-full h-full relative">
                  {videoThumb ? (
                    <img src={videoThumb} className="w-full h-full object-cover" alt="Video Thumbnail" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-indigo-50 text-indigo-500 gap-2">
                      <Film size={32} />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Video File</span>
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
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    navigator.clipboard.writeText(url); 
                    alert("URL Copied!"); 
                  }} 
                  className="p-2 bg-white rounded-lg text-slate-800 hover:bg-blue-50 transition-colors"
                >
                  <Link size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
