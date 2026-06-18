"use client";

import dynamic from 'next/dynamic';

const GrapesEditor = dynamic(
  () => import('@/components/template-builder/GrapesEditor').then(mod => mod.GrapesEditor),
  { 
    ssr: false, 
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-[#18181b] text-zinc-500">
        Loading Advanced Builder...
      </div>
    )
  }
);

export function BuilderWrapper() {
  return <GrapesEditor />;
}
