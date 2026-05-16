"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ShieldAlert, Zap, CheckCircle2, Info, WifiOff } from "lucide-react";
import { authFetch } from "@/lib/client-auth";

type PulseStatus = 'loading' | 'healthy' | 'warning' | 'critical' | 'unreachable';

export const SystemPulse = () => {
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState<PulseStatus>('loading');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/system/intelligence');
      if (!res.ok) {
        setStatus('unreachable');
        setData(null);
        return;
      }
      const json = await res.json();
      if (json.success && json.health) {
        setData(json);
        setStatus(json.health.status as PulseStatus ?? 'healthy');
      } else {
        setStatus('unreachable');
        setData(null);
      }
    } catch {
      setStatus('unreachable');
      setData(null);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 300_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (status === 'loading') return (
    <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 animate-pulse">
      <div className="w-2 h-2 rounded-full bg-slate-300" />
      <div className="h-3 w-20 bg-slate-200 rounded" />
    </div>
  );

  const colorMap: Record<PulseStatus, string> = {
    loading:     'text-slate-500 bg-slate-50 border-slate-100',
    healthy:     'text-emerald-500 bg-emerald-50 border-emerald-100',
    warning:     'text-amber-500 bg-amber-50 border-amber-100',
    critical:    'text-red-500 bg-red-50 border-red-100',
    unreachable: 'text-slate-400 bg-slate-50 border-slate-200',
  };

  const dotMap: Record<PulseStatus, string> = {
    loading:     'bg-slate-300',
    healthy:     'bg-emerald-500',
    warning:     'bg-amber-500',
    critical:    'bg-red-500',
    unreachable: 'bg-slate-400',
  };

  const health = data?.health;
  const messages: string[] = health?.messages ?? [];

  return (
    <div className={`p-4 rounded-2xl border transition-all duration-500 ${colorMap[status]}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${dotMap[status]} ${status !== 'unreachable' ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] font-black uppercase tracking-widest">System Pulse</span>
        </div>
        <span className="text-[10px] font-bold opacity-60">
          {status.toUpperCase()}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h4 className="text-sm font-black tracking-tight flex items-center gap-1.5">
            {status === 'unreachable'
              ? <><WifiOff size={14} /> Monitoring Unreachable</>
              : status === 'healthy'
              ? <><CheckCircle2 size={14} /> Systems Nominal</>
              : <><ShieldAlert size={14} /> Action Required</>
            }
          </h4>
          {status === 'unreachable' ? (
            <p className="text-[9px] font-bold opacity-60 mt-1">
              Could not reach intelligence API
            </p>
          ) : (
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
          )}
        </div>
        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-white/50 border border-current">
          <Zap size={18} className={status === 'healthy' ? 'animate-bounce' : status === 'unreachable' ? '' : 'animate-pulse'} />
        </div>
      </div>

      {messages.length > 0 && (
        <div className="mt-3 p-2 bg-white/40 rounded-lg text-[9px] font-bold leading-tight flex flex-col gap-1">
          {messages.map((m: string, i: number) => (
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
