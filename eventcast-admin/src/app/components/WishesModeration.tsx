"use client";

import React from "react";
import { RefreshCw, Trash2 } from "lucide-react";

interface WishesModerationProps {
  wishes: any[];
  isLoadingWishes: boolean;
  fetchWishes: () => void;
  deleteWish: (id: string) => void;
}

export const WishesModeration: React.FC<WishesModerationProps> = ({
  wishes,
  isLoadingWishes,
  fetchWishes,
  deleteWish
}) => {
  return (
    <div className="max-w-6xl mx-auto space-y-7 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Wishes Moderation</h2>
          <p className="text-[10px] text-white/30 font-black uppercase tracking-widest mt-1">Review and manage guest interactions</p>
        </div>
        <button 
          onClick={fetchWishes} 
          className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-all shadow-sm"
        >
          <RefreshCw size={20} className={isLoadingWishes ? 'animate-spin' : ''} />
        </button>
      </div>
      
      <div 
        className="rounded-3xl border border-white/[0.08] overflow-hidden backdrop-blur-md"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-white/[0.03] border-b border-white/[0.08]">
                <th className="p-5 text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Platform / Event</th>
                <th className="p-5 text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">From</th>
                <th className="p-5 text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Message</th>
                <th className="p-5 text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Timestamp</th>
                <th className="p-5 text-[10px] font-black text-white/30 uppercase tracking-[0.2em] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {wishes.length === 0 ? (
                <tr><td colSpan={5} className="p-20 text-center text-white/20 font-black uppercase tracking-widest text-[10px] italic">Zero interactions logged in database.</td></tr>
              ) : (
                wishes.map(wish => (
                  <tr key={wish.id} className="hover:bg-white/[0.04] group transition-all duration-300">
                    <td className="p-5">
                      {wish.events ? (
                        <span className="bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded-lg border border-blue-500/20 text-[10px] font-black uppercase tracking-widest">
                          {wish.events.groom_name || wish.events.celebrant_name}
                        </span>
                      ) : (
                        <span className="text-white/10 italic text-xs font-bold uppercase tracking-widest">Deleted Platform</span>
                      )}
                    </td>
                    <td className="p-5 text-sm font-black text-white/90">{wish.name}</td>
                    <td className="p-5 text-[13px] text-white/60 max-w-md leading-relaxed">
                      <span className="font-serif italic opacity-40 text-lg mr-1">"</span>
                      {wish.message}
                      <span className="font-serif italic opacity-40 text-lg ml-1">"</span>
                    </td>
                    <td className="p-5 text-[10px] text-white/20 font-mono font-bold uppercase tracking-tight">
                      {new Date(wish.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="p-5 text-right">
                      <button 
                        onClick={() => {
                          if (window.confirm("Purge this interaction from database?")) {
                            deleteWish(wish.id);
                          }
                        }} 
                        className="p-2.5 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded-xl border border-transparent hover:border-red-500/20 transition-all"
                        title="Delete Wish"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
