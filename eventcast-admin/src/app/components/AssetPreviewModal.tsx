"use client";

import React from "react";
import { X, Link } from "lucide-react";

interface AssetPreviewModalProps {
  selectedAsset: string | null;
  setSelectedAsset: (url: string | null) => void;
}

export const AssetPreviewModal: React.FC<AssetPreviewModalProps> = ({
  selectedAsset,
  setSelectedAsset
}) => {
  if (!selectedAsset) return null;

  const isVideo = selectedAsset.toLowerCase().endsWith('.mp4') || 
                  selectedAsset.toLowerCase().endsWith('.mov') || 
                  selectedAsset.includes('/video/upload/');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/95 backdrop-blur-md animate-in fade-in duration-300">
      <button 
        onClick={() => setSelectedAsset(null)}
        className="absolute top-6 right-6 p-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition-all border border-white/20"
      >
        <X size={28} />
      </button>
      
      <div className="max-w-5xl w-full max-h-[85vh] flex items-center justify-center">
        {isVideo ? (
          <video 
            src={selectedAsset} 
            controls 
            autoPlay 
            className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl shadow-black/50"
          />
        ) : (
          <img 
            src={selectedAsset} 
            alt="Preview" 
            className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl shadow-black/50 object-contain"
          />
        )}
      </div>
      
      <div className="absolute bottom-10 flex flex-col items-center gap-4">
        <code className="bg-white/10 px-4 py-2 rounded-lg text-white/80 text-xs font-mono border border-white/10 max-w-sm truncate">
          {selectedAsset}
        </code>
        <button 
          onClick={() => { navigator.clipboard.writeText(selectedAsset); alert("URL Copied!"); }}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-xl"
        >
          <Link size={20} /> Copy Asset URL
        </button>
      </div>
    </div>
  );
};
