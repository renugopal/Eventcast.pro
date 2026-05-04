"use client";

export const runtime = 'edge';

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Heart, Eye, Users, Calendar, Activity, Clock, MapPin, Loader2 } from "lucide-react";

export default function ClientPortal() {
  const { slug } = useParams();
  const [event, setEvent] = useState<any>(null);
  const [wishes, setWishes] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>({ totalViews: 0, rawViews: [] });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      // Fetch Event
      const { data: eventData } = await supabase
        .from('events')
        .select('*')
        .eq('slug', slug)
        .single();

      if (eventData) {
        setEvent(eventData);

        // Fetch Wishes
        const { data: wishesData } = await supabase
          .from('wishes')
          .select('*')
          .eq('event_id', eventData.id)
          .order('created_at', { ascending: false });
        
        if (wishesData) setWishes(wishesData);

        // Fetch Analytics
        const { data: viewsData } = await supabase
          .from('page_views')
          .select('*')
          .eq('event_id', eventData.id);

        if (viewsData) {
          setAnalytics({
            totalViews: viewsData.length,
            rawViews: viewsData
          });
        }
      }
      setIsLoading(false);
    }

    if (slug) fetchData();
  }, [slug]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-500" size={48} />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <h1 className="text-2xl font-black text-slate-800">Event Not Found</h1>
          <p className="text-slate-500 mt-2">The link you followed may be invalid.</p>
        </div>
      </div>
    );
  }

  const title = `${event.groom_name || event.celebrant_name} ${event.bride_name ? '& ' + event.bride_name : ''}`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight">{title}</h1>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">{event.event_type} Portal</p>
          </div>
          <a href={`https://eventcast.pro/events/${event.slug}`} target="_blank" className="px-4 py-2 bg-blue-50 text-blue-600 text-sm font-bold rounded-xl hover:bg-blue-100 transition-colors">
            View Live Site
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Welcome Card */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-8 text-white shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-10 opacity-10 pointer-events-none">
            <Heart size={200} />
          </div>
          <h2 className="text-3xl font-black mb-2">Welcome to your Portal!</h2>
          <p className="text-blue-100 font-medium max-w-lg mb-6">
            Here you can track how many people are watching your live stream and read all the beautiful wishes your guests have left for you.
          </p>
          <div className="flex gap-4">
             <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 min-w-[140px]">
               <div className="flex items-center gap-2 text-blue-200 text-xs font-bold uppercase tracking-widest mb-1">
                 <Eye size={14} /> Total Views
               </div>
               <div className="text-3xl font-black">{analytics.totalViews}</div>
             </div>
             <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 min-w-[140px]">
               <div className="flex items-center gap-2 text-blue-200 text-xs font-bold uppercase tracking-widest mb-1">
                 <Heart size={14} /> Guest Wishes
               </div>
               <div className="text-3xl font-black">{wishes.length}</div>
             </div>
          </div>
        </div>

        {/* Wishes Section */}
        <div>
          <div className="flex items-center gap-2 mb-6">
            <Heart className="text-pink-500" size={24} />
            <h3 className="text-2xl font-black text-slate-800 tracking-tight">Guest Book & Wishes</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {wishes.length === 0 ? (
              <div className="col-span-full bg-white p-10 rounded-3xl border border-slate-200 text-center text-slate-400">
                <p className="font-bold">No wishes have been posted yet.</p>
                <p className="text-sm mt-1">When guests leave a message on your site, it will appear here instantly.</p>
              </div>
            ) : (
              wishes.map(wish => (
                <div key={wish.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative group hover:border-pink-200 transition-colors">
                  <div className="absolute top-6 right-6 text-[10px] font-bold text-slate-400">
                    {new Date(wish.created_at).toLocaleDateString()}
                  </div>
                  <h4 className="text-lg font-black text-slate-800 mb-2">{wish.name}</h4>
                  <p className="text-slate-600 font-medium leading-relaxed">"{wish.message}"</p>
                </div>
              ))
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
