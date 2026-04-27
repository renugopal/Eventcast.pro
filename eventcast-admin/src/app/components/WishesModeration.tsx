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
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">Wishes Moderation</h2>
        <button onClick={fetchWishes} className="p-2 bg-white border rounded-lg hover:bg-slate-50 transition-colors">
          <RefreshCw size={20} className={isLoadingWishes ? 'animate-spin' : ''} />
        </button>
      </div>
      
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">Event</th>
                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">From</th>
                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">Message</th>
                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">Date</th>
                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {wishes.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-400 font-medium italic">No wishes to moderate.</td></tr>
              ) : (
                wishes.map(wish => (
                  <tr key={wish.id} className="hover:bg-slate-50/50 group transition-colors">
                    <td className="p-4 text-xs font-bold text-slate-700">
                      {wish.events ? (
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded shadow-sm">
                          {wish.events.groom_name || wish.events.celebrant_name}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Unknown Event</span>
                      )}
                    </td>
                    <td className="p-4 text-xs font-bold text-slate-800">{wish.name}</td>
                    <td className="p-4 text-xs text-slate-600 max-w-md italic font-serif">"{wish.message}"</td>
                    <td className="p-4 text-[10px] text-slate-400 font-mono font-medium">
                      {new Date(wish.created_at).toLocaleString()}
                    </td>
                    <td className="p-4 text-right">
                      <button 
                        onClick={() => {
                          if (window.confirm("Are you sure you want to delete this wish?")) {
                            deleteWish(wish.id);
                          }
                        }} 
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
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
