"use client";

import React, { useState, useEffect } from "react";
import { Activity, ShieldAlert, Zap, CheckCircle2, Info } from "lucide-react";
import { authFetch } from "@/lib/client-auth";

export const SystemPulse = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const res = await authFetch('/api/system/intelligence');
      const json = await res.json();
      if (json.success) setData(json);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 300000); // Every 5 mins
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 animate-pulse">
      <div className="w-2 h-2 rounded-full bg-slate-300"></div>
      <div className="h-3 w-20 bg-slate-200 rounded"></div>
    </div>
  );

  const health = data?.health || { status: 'healthy', score: 100, messages: [] };
  
  const getStatusColor = () => {
    if (health.status === 'critical') return 'text-red-500 bg-red-50 border-red-100';
    if (health.status === 'warning') return 'text-amber-500 bg-amber-50 border-amber-100';
    return 'text-emerald-500 bg-emerald-50 border-emerald-100';
  };

  const getDotColor = () => {
    if (health.status === 'critical') return 'bg-red-500';
    if (health.status === 'warning') return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  return (
    <div className={`p-4 rounded-2xl border transition-all duration-500 ${getStatusColor()}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getDotColor()} animate-pulse`}></div>
          <span className="text-[10px] font-black uppercase tracking-widest">System Pulse</span>
        </div>
        <span className="text-[10px] font-bold opacity-60">
            {health.status.toUpperCase()}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
            <h4 className="text-sm font-black tracking-tight flex items-center gap-1.5">
                {health.status === 'healthy' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {health.status === 'healthy' ? 'Systems Nominal' : 'Action Required'}
            </h4>
            <div className="mt-1 flex gap-2 overflow-hidden">
                {data?.raw?.cloudinary && (
                    <div className="text-[9px] font-bold opacity-70 whitespace-nowrap">
                        ☁️ {Math.round((data.raw.cloudinary.bandwidth.used / data.raw.cloudinary.bandwidth.limit) * 100)}% BW
                    </div>
                )}
                {data?.raw?.cloudinary && (
                    <div className="text-[9px] font-bold opacity-70 whitespace-nowrap">
                        ⚙️ {Math.round((data.raw.cloudinary.transformations.used / data.raw.cloudinary.transformations.limit) * 100)}% TF
                    </div>
                )}
            </div>
        </div>
        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-white/50 border border-current">
            <Zap size={18} className={health.status === 'healthy' ? 'animate-bounce' : 'animate-pulse'} />
        </div>
      </div>

      {health.messages.length > 0 && (
        <div className="mt-3 p-2 bg-white/40 rounded-lg text-[9px] font-bold leading-tight flex flex-col gap-1">
           {health.messages.map((m: string, i: number) => (
             <div key={i} className="flex items-start gap-1">
                <Info size={10} className="mt-0.5" />
                <span>{m}</span>
             </div>
           ))}
        </div>
      )}
    </div>
  );
};
