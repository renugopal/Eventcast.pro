"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { 
  PlusCircle, List, Settings, BarChart3, Image as ImageIcon, Video, Search, 
  MapPin, Clock, Calendar, UploadCloud, Film, Play, CheckCircle2, AlertCircle, 
  Loader2, Link as LinkIcon, X, Layout
} from "lucide-react";
import { useRouter } from "next/navigation";

// Sub-components
import { Sidebar } from "./components/Sidebar";
import { EventTable } from "./components/EventTable";
import { WishesModeration } from "./components/WishesModeration";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { AssetLibrary } from "./components/AssetLibrary";
import { PhotographerManagement } from "./components/PhotographerManagement";
import { AssetPreviewModal } from "./components/AssetPreviewModal";

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("create");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [events, setEvents] = useState<any[]>([]);
  const [wishes, setWishes] = useState<any[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any[]>([]);
  const [assetLibrary, setAssetLibrary] = useState<any[]>([]);
  const [photographers, setPhotographers] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isLoadingWishes, setIsLoadingWishes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<{type: 'success' | 'error', message: string} | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  // Form State
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    eventType: "Wedding",
    groomName: "",
    brideName: "",
    celebrantName: "",
    customTopTitle: "",
    eventDate: new Date().toISOString().split('T')[0],
    eventTime: "",
    timerTargetTime: "",
    showTimer: true,
    venueName: "",
    venueMapLink: "",
    invitationVideoUrl: "",
    thumbnailUrl: "",
    privacyStatus: "Unlisted (Link Only)",
    galleryUrls: "",
    vodLink: "",
    templateId: "wedding-template-01",
    youtubePrivacy: "public",
    autoGenerateThumbnail: true
  });

  const [photographerSearchQuery, setPhotographerSearchQuery] = useState("");
  const [selectedPhotographer, setSelectedPhotographer] = useState<any>(null);
  const [showPhotographerList, setShowPhotographerList] = useState(false);
  const [selectedBaseDesign, setSelectedBaseDesign] = useState("ec_premium_pink_v1");

  const thumbInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const baseDesigns = [
    { id: 'ec_premium_pink_v1', name: 'Elegant Pink' },
    { id: 'ec_floral_gold_v1', name: 'Floral Gold' },
    { id: 'ec_traditional_v1', name: 'Traditional' },
    { id: 'ec_modern_sage_v1', name: 'Modern Sage' }
  ];

  useEffect(() => {
    checkUser();
    fetchEvents();
    fetchWishes();
    fetchAnalytics();
    fetchPhotographers();
  }, []);

  async function checkUser() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push("/login");
    } else {
      setIsAuthLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function fetchEvents() {
    setIsLoadingEvents(true);
    const { data, error } = await supabase.from('events').select('*').order('created_at', { ascending: false });
    if (data) {
      setEvents(data);
      const allAssets = data.flatMap(e => [
        e.thumbnail_url,
        e.invitation_video_url,
        ...(Array.isArray(e.gallery_urls) ? e.gallery_urls : [])
      ]).filter(Boolean);
      setAssetLibrary(Array.from(new Set(allAssets)));
    }
    setIsLoadingEvents(false);
  }

  async function fetchWishes() {
    setIsLoadingWishes(true);
    const { data } = await supabase.from('wishes').select('*, events(groom_name, celebrant_name)').order('created_at', { ascending: false });
    if (data) setWishes(data);
    setIsLoadingWishes(false);
  }

  async function fetchAnalytics() {
    const { data } = await supabase.from('events').select('groom_name, celebrant_name, event_type, view_count').order('view_count', { ascending: false });
    if (data) setAnalyticsData(data);
  }

  async function fetchPhotographers() {
    const { data } = await supabase.from('photographers').select('*').order('name');
    if (data) setPhotographers(data);
  }

  const handleInputChange = (e: any) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setFormData(prev => ({ ...prev, [name]: val }));
  };

  // Auto-resolve Google Maps Short Links and Extract Name
  useEffect(() => {
    const resolveAndExtract = async () => {
      let link = formData.venueMapLink;
      
      // 1. Resolve and get Title for ALL Google Maps links
      if (link.includes('google.com/maps') || link.includes('goo.gl')) {
        try {
          const res = await fetch('/api/resolve-url', {
            method: 'POST',
            body: JSON.stringify({ url: link })
          });
          const data = await res.json();
          
          if (data.resolvedUrl) link = data.resolvedUrl;
          
          // Use Title if available (contains Venue Name, City)
          if (data.title && formData.venueName !== data.title) {
            setFormData(prev => ({ ...prev, venueName: data.title, venueMapLink: link }));
            return; 
          }
        } catch (e) {
          console.error("Link resolution failed", e);
        }
      }

      // 2. Extract Name and Address from Full URL
      if (link.includes('google.com/maps')) {
        try {
          let extractedName = "";
          
          if (link.includes('/place/')) {
            extractedName = link.split('/place/')[1].split('/')[0];
          } else if (link.includes('q=')) {
            extractedName = new URL(link).searchParams.get('q') || "";
          }

          if (extractedName) {
            const decodedName = decodeURIComponent(extractedName.replace(/\+/g, ' '));
            const cleanedName = decodedName.split('/@')[0].trim();
            
            if (cleanedName && formData.venueName !== cleanedName) {
              setFormData(prev => ({ ...prev, venueName: cleanedName, venueMapLink: link }));
            }
          }
        } catch (e) {
          console.error("Name extraction failed", e);
        }
      }
    };

    if (formData.venueMapLink) {
      const timer = setTimeout(resolveAndExtract, 1000); // Debounce
      return () => clearTimeout(timer);
    }
  }, [formData.venueMapLink]);

  async function uploadToCloudinary(files: FileList | null, type: string) {
    if (!files || files.length === 0) return;
    setIsUploading(type);
    const uploadedUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);
      formDataUpload.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'eventcast_gallery');

      try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/upload`, {
          method: 'POST',
          body: formDataUpload
        });
        const data = await res.json();
        if (data.secure_url) uploadedUrls.push(data.secure_url);
      } catch (err) {
        console.error("Upload error:", err);
      }
    }

    if (type === 'thumbnail') setFormData(prev => ({ ...prev, thumbnailUrl: uploadedUrls[0] }));
    else if (type === 'video') setFormData(prev => ({ ...prev, invitationVideoUrl: uploadedUrls[0] }));
    else if (type === 'gallery') {
      const currentUrls = formData.galleryUrls;
      const newUrls = uploadedUrls.join('\n');
      setFormData(prev => ({ ...prev, galleryUrls: currentUrls ? `${currentUrls}\n${newUrls}` : newUrls }));
    }
    setIsUploading(null);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      const payload = {
        ...formData,
        photographerId: selectedPhotographer?.id,
        galleryUrls: formData.galleryUrls.split('\n').filter(url => url.trim()),
        baseDesign: selectedBaseDesign
      };

      const endpoint = isEditing ? '/api/events/generate' : '/api/events/generate';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, isEditing, editingId })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setSubmitStatus({ type: 'success', message: `Success! Event ${isEditing ? 'Updated' : 'Created'}.` });
      resetForm();
      fetchEvents();
    } catch (err: any) {
      setSubmitStatus({ type: 'error', message: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setIsEditing(false);
    setEditingId(null);
    setFormData({
      eventType: "Wedding",
      groomName: "",
      brideName: "",
      celebrantName: "",
      customTopTitle: "",
      eventDate: new Date().toISOString().split('T')[0],
      eventTime: "",
      timerTargetTime: "",
      showTimer: true,
      venueName: "",
      venueMapLink: "",
      invitationVideoUrl: "",
      thumbnailUrl: "",
      privacyStatus: "Unlisted (Link Only)",
      galleryUrls: "",
      vodLink: "",
      templateId: "wedding-template-01",
      youtubePrivacy: "public",
      autoGenerateThumbnail: true
    });
    setSelectedPhotographer(null);
  };

  const handleEditClick = (event: any) => {
    setIsEditing(true);
    setEditingId(event.id);
    setFormData({
      eventType: event.event_type || "Wedding",
      groomName: event.groom_name || "",
      brideName: event.bride_name || "",
      celebrantName: event.celebrant_name || "",
      customTopTitle: event.custom_top_title || "",
      eventDate: event.event_date || "",
      eventTime: event.event_time || "",
      timerTargetTime: event.timer_target_time || "",
      showTimer: event.show_timer ?? true,
      venueName: event.venue_name || "",
      venueMapLink: event.venue_map_link || "",
      invitationVideoUrl: event.invitation_video_url || "",
      thumbnailUrl: event.thumbnail_url || "",
      privacyStatus: event.privacy_status || "Unlisted (Link Only)",
      galleryUrls: Array.isArray(event.gallery_urls) ? event.gallery_urls.join('\n') : "",
      vodLink: event.vod_link || "",
      templateId: event.template_id || "wedding-template-01",
      youtubePrivacy: "public",
      autoGenerateThumbnail: event.auto_generate_thumbnail ?? true
    });
    const pg = photographers.find(p => p.id === event.photographer_id);
    if (pg) setSelectedPhotographer(pg);
    setActiveTab("create");
  };

  async function fullDeleteEvent(id: string) {
    if (!confirm("Are you sure?")) return;
    setIsLoadingEvents(true);
    try {
      await fetch('/api/events/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      fetchEvents();
    } catch (err) {
      alert("Delete failed.");
    } finally {
      setIsLoadingEvents(false);
    }
  }

  async function addPhotographer(e: any) {
    e.preventDefault();
    setIsSubmitting(true);
    const fd = new FormData(e.target);
    const { error } = await supabase.from('photographers').insert({
      name: fd.get('name'),
      phone_number: fd.get('phone'),
      city: fd.get('city'),
      logo_url: fd.get('logo_url'),
      instagram_url: fd.get('instagram_url')
    });
    if (!error) {
      alert("Photographer added!");
      e.target.reset();
      fetchPhotographers();
    }
    setIsSubmitting(false);
  }

  function getVideoThumbnail(url: string) {
    if (url.includes('cloudinary.com')) {
      return url.replace(/\.(mp4|mov|avi)$/, '.jpg');
    }
    return null;
  }

  if (isAuthLoading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" size={48} /></div>;

  const filteredPhotographers = photographers.filter(p => p.name.toLowerCase().includes(photographerSearchQuery.toLowerCase()));

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} handleSignOut={handleSignOut} />

      <main className="flex-1 p-12 overflow-y-auto">
        {activeTab === "create" && (
          <div className="max-w-5xl mx-auto pb-20">
            {submitStatus && (
              <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${submitStatus.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                {submitStatus.type === 'success' ? <CheckCircle2 className="text-green-500" /> : <AlertCircle className="text-red-500" />}
                <p className="font-medium">{submitStatus.message}</p>
              </div>
            )}

            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-10">
              <form onSubmit={handleSubmit} className="space-y-12">
                {/* 1. Identity Section */}
                <section>
                  <h3 className="text-lg font-black text-slate-800 border-b border-slate-100 pb-4 mb-8 flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center"><Calendar size={18} /></div>
                    Event Identity
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="md:col-span-1">
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Custom Welcome Title</label>
                      <input type="text" name="customTopTitle" value={formData.customTopTitle} onChange={handleInputChange} placeholder="e.g. Welcome to Our Wedding" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Event Type</label>
                      <select name="eventType" value={formData.eventType} onChange={handleInputChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800 appearance-none">
                        <option>Wedding</option>
                        <option>Engagement</option>
                        <option>Birthday</option>
                        <option>Half Saree</option>
                      </select>
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Visual Template</label>
                      <select name="templateId" value={formData.templateId} onChange={handleInputChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800 appearance-none">
                        <option value="wedding-template-01">Premium Pink & Gold</option>
                        <option value="wedding-template">Modern Sage Theme</option>
                        <option value="wedding">Traditional Maroon</option>
                      </select>
                    </div>
                    {(formData.eventType === "Wedding" || formData.eventType === "Engagement") ? (
                      <>
                        <div className="md:col-span-1">
                          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Groom Name</label>
                          <input type="text" name="groomName" value={formData.groomName} onChange={handleInputChange} required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Bride Name</label>
                          <input type="text" name="brideName" value={formData.brideName} onChange={handleInputChange} required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                        </div>
                      </>
                    ) : (
                      <div className="md:col-span-3">
                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Celebrant Name</label>
                        <input type="text" name="celebrantName" value={formData.celebrantName} onChange={handleInputChange} required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                      </div>
                    )}
                  </div>
                </section>

                {/* 2. Schedule Section */}
                <section>
                  <h3 className="text-lg font-black text-slate-800 border-b border-slate-100 pb-4 mb-8 flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center"><Clock size={18} /></div>
                    Timing & Schedule
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Event Date</label>
                      <input type="date" name="eventDate" value={formData.eventDate} onChange={handleInputChange} required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Sumuhurtham Time</label>
                      <input type="time" name="eventTime" value={formData.eventTime} onChange={handleInputChange} required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Live Start Time</label>
                      <input type="time" name="timerTargetTime" value={formData.timerTargetTime} onChange={handleInputChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                    </div>
                  </div>
                </section>

                {/* 3. Venue Details */}
                <section>
                  <h3 className="text-lg font-black text-slate-800 border-b border-slate-100 pb-4 mb-8 flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center"><MapPin size={18} /></div>
                    Venue & Location
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Venue Name / Address</label>
                      <textarea name="venueName" value={formData.venueName} onChange={handleInputChange} rows={2} required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800 mb-4" />
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Google Maps Link</label>
                      <input type="text" name="venueMapLink" value={formData.venueMapLink} onChange={handleInputChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                    </div>
                    <div className="bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden h-full min-h-[150px]">
                      {formData.venueMapLink || formData.venueName ? (
                        <iframe width="100%" height="100%" style={{ border: 0 }} loading="lazy" src={`https://maps.google.com/maps?q=${encodeURIComponent(formData.venueName || formData.venueMapLink)}&output=embed`}></iframe>
                      ) : (
                        <div className="text-slate-300 flex flex-col items-center"><MapPin size={32} className="mb-2" /><span className="text-xs font-bold uppercase">Map Preview</span></div>
                      )}
                    </div>
                  </div>
                </section>

                {/* 4. Media & Cloudinary */}
                <section>
                  <h3 className="text-lg font-black text-slate-800 border-b border-slate-100 pb-4 mb-8 flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center"><UploadCloud size={18} /></div>
                    Media & Assets
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">SEO Thumbnail</label>
                        <div className="flex items-center gap-2">
                           <input type="checkbox" id="autoThumb" checked={formData.autoGenerateThumbnail} onChange={(e) => setFormData(prev => ({ ...prev, autoGenerateThumbnail: e.target.checked }))} className="rounded text-blue-600" />
                           <label htmlFor="autoThumb" className="text-[10px] font-bold text-blue-600 uppercase cursor-pointer">Auto-Design</label>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <input type="text" value={formData.thumbnailUrl} readOnly className="flex-1 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-medium text-slate-600" />
                        <button type="button" onClick={() => thumbInputRef.current?.click()} className="p-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-colors">
                          {isUploading === 'thumbnail' ? <Loader2 className="animate-spin" size={18} /> : <UploadCloud size={18} />}
                        </button>
                      </div>
                      <input type="file" ref={thumbInputRef} hidden accept="image/*" onChange={(e) => uploadToCloudinary(e.target.files, 'thumbnail')} />
                    </div>

                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Invitation Video (MP4)</label>
                      <div className="flex gap-2">
                        <input type="text" value={formData.invitationVideoUrl} readOnly className="flex-1 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-medium text-slate-600" />
                        <button type="button" onClick={() => videoInputRef.current?.click()} className="p-4 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-colors">
                          {isUploading === 'video' ? <Loader2 className="animate-spin" size={18} /> : <Film size={18} />}
                        </button>
                      </div>
                      <input type="file" ref={videoInputRef} hidden accept="video/*" onChange={(e) => uploadToCloudinary(e.target.files, 'video')} />
                    </div>

                    {/* Gallery Upload */}
                    <div className="md:col-span-2">
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Photo Gallery (Bulk Upload)</label>
                      <textarea name="galleryUrls" value={formData.galleryUrls} onChange={handleInputChange} rows={3} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-mono text-xs mb-2 text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 transition-all" placeholder="URLs will appear here after upload..." />
                      <button type="button" onClick={() => galleryInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 py-4 bg-slate-800 text-white rounded-2xl hover:bg-slate-900 font-bold transition-colors">
                        {isUploading === 'gallery' ? <Loader2 className="animate-spin" size={18} /> : <ImageIcon size={18} />}
                        Select Multiple Gallery Photos
                      </button>
                      <input type="file" ref={galleryInputRef} hidden multiple accept="image/*" onChange={(e) => uploadToCloudinary(e.target.files, 'gallery')} />
                    </div>
                  </div>
                </section>

                {/* 5. YouTube & Credits */}
                <section>
                  <h3 className="text-lg font-black text-slate-800 border-b border-slate-100 pb-4 mb-8 flex items-center gap-3">
                    <div className="w-8 h-8 bg-red-50 text-red-600 rounded-lg flex items-center justify-center"><Play size={18} /></div>
                    YouTube & Production
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">YouTube Privacy</label>
                      <div className="flex gap-4">
                        {['public', 'unlisted'].map((p) => (
                          <button key={p} type="button" onClick={() => setFormData(prev => ({ ...prev, youtubePrivacy: p }))} className={`flex-1 p-4 rounded-2xl border-2 font-bold transition-all ${formData.youtubePrivacy === p ? 'border-red-500 bg-red-50 text-red-600' : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200'}`}>
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Assign Photographer</label>
                      <div className="relative">
                        <input type="text" placeholder="Search Studio..." value={selectedPhotographer ? selectedPhotographer.name : photographerSearchQuery} onChange={(e) => { setPhotographerSearchQuery(e.target.value); setSelectedPhotographer(null); setShowPhotographerList(true); }} onFocus={() => setShowPhotographerList(true)} className="w-full p-4 pl-12 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-800" />
                        <Search className="absolute left-4 top-4 text-slate-400" size={20} />
                        {showPhotographerList && photographerSearchQuery && !selectedPhotographer && (
                          <div className="absolute z-20 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl max-h-48 overflow-y-auto">
                            {filteredPhotographers.map(p => (
                              <button key={p.id} type="button" onClick={() => { setSelectedPhotographer(p); setShowPhotographerList(false); }} className="w-full p-4 hover:bg-blue-50 text-left border-b border-slate-50 transition-colors">
                                <p className="font-bold text-slate-800">{p.name}</p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* SEO & Social Preview Section */}
                <section className="bg-slate-50 rounded-3xl p-8 border border-slate-100">
                  <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2">
                    <Search size={18} className="text-blue-500" /> WhatsApp & Social Share Preview
                  </h3>
                  
                  <div className="max-w-[350px] mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="aspect-video bg-slate-100 relative overflow-hidden">
                      {formData.thumbnailUrl ? (
                        <img src={formData.thumbnailUrl} className="w-full h-full object-cover" alt="Preview" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                          <ImageIcon size={32} strokeWidth={1} />
                          <span className="text-[10px] font-bold uppercase tracking-widest">No Thumbnail</span>
                        </div>
                      )}
                    </div>
                    <div className="p-4 bg-[#f0f2f5]">
                      <h4 className="text-sm font-bold text-slate-800 truncate leading-tight">
                        {formData.groomName || formData.celebrantName || "Couple Names"} & {formData.brideName || "Family"} {formData.eventType} | {formData.eventDate || "Date"}
                      </h4>
                      <p className="text-xs text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                        Join us live for the {formData.eventType} of {formData.groomName || formData.celebrantName || "Name"} & {formData.brideName || "Family"}. Venue: {formData.venueName || "Location Name"}.
                      </p>
                      <div className="text-[10px] text-slate-400 mt-2 font-mono">https://eventcast.pro/events/...</div>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center mt-4 font-bold tracking-widest uppercase">
                    * This is how the link will look when shared *
                  </p>
                </section>

                <div className="pt-10">
                  <button type="submit" disabled={isSubmitting || !!isUploading} className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black text-xl shadow-2xl shadow-blue-200 hover:bg-blue-700 transition-all disabled:bg-slate-300 transform active:scale-[0.98]">
                    {isSubmitting ? (isEditing ? "Updating Platform..." : "Creating Platform...") : (isEditing ? "Save & Update Event" : "Create Automated Platform")}
                  </button>
                  {isEditing && (
                    <button type="button" onClick={resetForm} className="w-full mt-4 py-3 text-slate-400 font-bold hover:text-slate-600 transition-colors">
                      Cancel Editing
                    </button>
                  )}
                </div>
              </form>
            </div>

          </div>
        )}

        {activeTab === "list" && <EventTable events={events} isLoadingEvents={isLoadingEvents} fetchEvents={fetchEvents} handleEditClick={handleEditClick} generateWebsite={fetchEvents} fullDeleteEvent={fullDeleteEvent} />}
        {activeTab === "moderation" && <WishesModeration wishes={wishes} isLoadingWishes={isLoadingWishes} fetchWishes={fetchWishes} deleteWish={fetchWishes} />}
        {activeTab === "analytics" && <AnalyticsDashboard analyticsData={analyticsData} />}
        {activeTab === "assets" && <AssetLibrary assetLibrary={assetLibrary} getVideoThumbnail={getVideoThumbnail} setSelectedAsset={setSelectedAsset} />}
        {activeTab === "photographers" && <PhotographerManagement photographers={photographers} isSubmitting={isSubmitting} addPhotographer={addPhotographer} />}
        
      </main>

      <AssetPreviewModal selectedAsset={selectedAsset} setSelectedAsset={setSelectedAsset} />
    </div>
  );
}
