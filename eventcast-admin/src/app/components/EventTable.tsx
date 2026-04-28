"use client";

import React from "react";
import { RefreshCw, ExternalLink, Edit, Trash2, AlertCircle, Play, Copy } from "lucide-react";

interface EventTableProps {
  events: any[];
  isLoadingEvents: boolean;
  fetchEvents: () => void;
  handleEditClick: (event: any) => void;
  generateWebsite: (event: any) => void;
  fullDeleteEvent: (id: string) => void;
}

export const EventTable: React.FC<EventTableProps> = ({
  events,
  isLoadingEvents,
  fetchEvents,
  handleEditClick,
  generateWebsite,
  fullDeleteEvent
}) => {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Active Events</h2>
          <p className="text-sm text-slate-500 font-medium">Manage your automated wedding platforms</p>
        </div>
        <button 
          onClick={fetchEvents}
          disabled={isLoadingEvents}
          className="p-3 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-all border border-slate-200 group"
        >
          <RefreshCw size={20} className={isLoadingEvents ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'} />
        </button>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="p-5 text-[11px] font-black text-slate-400 uppercase tracking-widest">Event Identity</th>
                <th className="p-5 text-[11px] font-black text-slate-400 uppercase tracking-widest">Date & Time</th>
                <th className="p-5 text-[11px] font-black text-slate-400 uppercase tracking-widest">Venue</th>
                <th className="p-5 text-[11px] font-black text-slate-400 uppercase tracking-widest">YouTube / Stream</th>
                <th className="p-5 text-[11px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="p-5 text-[11px] font-black text-slate-400 uppercase tracking-widest text-right">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-20 text-center">
                    <div className="flex flex-col items-center gap-2 opacity-40">
                      <AlertCircle size={48} strokeWidth={1} />
                      <p className="font-bold text-slate-500">No events found yet.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                events.map(event => (
                  <tr key={event.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="p-5">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 flex-shrink-0">
                          {event.thumbnail_url ? (
                            <img src={event.thumbnail_url} className="w-full h-full object-cover" alt="Thumb" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300">
                              <AlertCircle size={20} />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-black text-slate-800 tracking-tight leading-none mb-1 text-sm uppercase">
                            {event.groom_name || event.celebrant_name} & {event.bride_name || 'Family'}
                          </div>
                          <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2">
                            {event.event_type}
                            {event.template_id && (
                              <span className="bg-blue-50 text-blue-400 px-1.5 py-0.5 rounded text-[8px] border border-blue-100">
                                {event.template_id.replace('wedding-template-', 'v')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-5">
                      <div className="text-sm font-bold text-slate-700">{event.event_date}</div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{event.event_time}</div>
                    </td>
                    <td className="p-5">
                      <div className="text-xs text-slate-600 font-medium max-w-[200px] truncate">{event.venue_name}</div>
                    </td>
                    <td className="p-5">
                      {event.stream_key ? (
                        <div className="flex flex-col gap-1.5 items-start">
                          <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                            <code className="text-[10px] font-mono text-slate-700">{event.stream_key}</code>
                            <button onClick={() => { navigator.clipboard.writeText(event.stream_key); alert("Copied!"); }} className="text-slate-400 hover:text-blue-500"><Copy size={12}/></button>
                          </div>
                          {event.vod_link && (
                            <a href={event.vod_link} target="_blank" className="flex items-center gap-1 text-[10px] text-red-600 font-bold uppercase bg-red-50 px-2 py-0.5 rounded-full hover:bg-red-100 transition-colors">
                              <Play size={10} /> Live Link
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-2 py-1 rounded">No Stream</span>
                      )}
                    </td>
                    <td className="p-5">
                       <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-[10px] font-black uppercase tracking-wider border border-green-100 shadow-sm inline-block">
                         Active
                       </span>
                    </td>
                    <td className="p-5">
                      <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                        <a 
                          href={`https://eventcast.pro/events/${event.slug}`} 
                          target="_blank" 
                          className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors border border-transparent hover:border-blue-200" 
                          title="View Live Page"
                        >
                          <ExternalLink size={18} />
                        </a>
                        <button 
                          onClick={() => generateWebsite(event)} 
                          className="p-2 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors border border-transparent hover:border-indigo-200" 
                          title="Force Regenerate Files"
                        >
                          <RefreshCw size={18} />
                        </button>
                        <button 
                          onClick={() => handleEditClick(event)} 
                          className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors border border-transparent hover:border-slate-200"
                        >
                          <Edit size={18} />
                        </button>
                        <button 
                          onClick={() => {
                            if (window.confirm("WARNING: FULL DELETE!\nThis will permanently delete the website record, the YouTube Live event, and ALL photos/videos from Cloudinary.\nThis cannot be undone. Proceed?")) {
                              fullDeleteEvent(event.id);
                            }
                          }} 
                          className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors border border-red-100 hover:border-red-200 shadow-sm" 
                          title="FULL DELETE (Website + YT + Media)"
                        >
                          <AlertCircle size={18} />
                        </button>
                      </div>
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
