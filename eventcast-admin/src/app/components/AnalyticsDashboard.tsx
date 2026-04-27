"use client";

import React from "react";

interface AnalyticsDashboardProps {
  analyticsData: any[];
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ analyticsData }) => {
  const totalViews = analyticsData.reduce((acc, curr) => acc + (curr.view_count || 0), 0);
  const avgViews = analyticsData.length > 0 ? Math.round(totalViews / analyticsData.length) : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <h2 className="text-2xl font-bold text-slate-800">Advanced Analytics</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.1em] mb-1">Total Views</p>
          <p className="text-3xl font-black text-slate-800 tracking-tight">{totalViews.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.1em] mb-1">Avg Views / Event</p>
          <p className="text-3xl font-black text-blue-600 tracking-tight">{avgViews.toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
         <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Event Name & Type</th>
                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest text-center">Views</th>
                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Growth Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {analyticsData.map((data, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-4">
                    <div className="text-sm font-bold text-slate-800">{data.groom_name || data.celebrant_name}</div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{data.event_type}</div>
                  </td>
                  <td className="p-4 text-center">
                    <span className="font-mono font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full text-sm">
                      {data.view_count || 0}
                    </span>
                  </td>
                  <td className="p-4">
                     <div className="flex items-center gap-3">
                        <div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden">
                           <div 
                             className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-1000" 
                             style={{ width: `${Math.min(100, (data.view_count / 1000) * 100)}%` }} 
                           />
                        </div>
                        <span className="text-[10px] font-bold text-slate-400">{Math.min(100, Math.round((data.view_count / 1000) * 100))}%</span>
                     </div>
                  </td>
                </tr>
              ))}
            </tbody>
         </table>
      </div>
    </div>
  );
};
