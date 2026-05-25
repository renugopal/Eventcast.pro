"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Heart, Star, PartyPopper, Cake, Crown, ChevronLeft, ChevronRight,
  Globe, Layout, Clock, MapPin, UploadCloud, Shield, Search, Zap,
  Image as ImageIcon, Loader2, CheckCircle2, Film, X
} from "lucide-react";
import { uploadToR2, uploadImageToCloudinary } from "@/lib/uploadHelpers";
import { authFetch } from "@/lib/client-auth";
import { useToast } from "./Toast";

const EVENT_TYPES = [
  { id: "Wedding", label: "Wedding", icon: Heart, color: "text-rose-500", bg: "bg-rose-50", border: "border-rose-100" },
  { id: "Reception", label: "Reception", icon: Star, color: "text-amber-500", bg: "bg-amber-50", border: "border-amber-100" },
  { id: "Engagement", label: "Engagement", icon: Crown, color: "text-purple-500", bg: "bg-purple-50", border: "border-purple-100" },
  { id: "Half Saree", label: "Half Saree", icon: PartyPopper, color: "text-emerald-500", bg: "bg-emerald-50", border: "border-emerald-100" },
  { id: "Dhoti Ceremony", label: "Dhoti Ceremony", icon: PartyPopper, color: "text-blue-500", bg: "bg-blue-50", border: "border-blue-100" },
  { id: "Birthday", label: "Birthday", icon: Cake, color: "text-pink-500", bg: "bg-pink-50", border: "border-pink-100" },
];

const TEMPLATES: Record<string, { id: string, name: string }[]> = {
  "Wedding": [
    { id: "wedding-template-01", name: "Pink & Gold Floral" },
    { id: "wedding-template", name: "Modern Sage" },
    { id: "wedding", name: "Traditional Maroon" }
  ],
  "Half Saree": [{ id: "half-saree-template-01", name: "Emerald Tradition" }],
  "Dhoti Ceremony": [{ id: "dhoti-ceremony-template-01", name: "Royal Blue Heritage" }],
  "Engagement": [{ id: "engagement-template-01", name: "Lavender Magic" }],
  "default": [{ id: "wedding-template-01", name: "Classic Theme" }]
};

export const CreateEventFlow = ({ 
  studioId, 
  studioSlug, 
  initialData = null, 
  isEditing = false,
  onComplete
}: { 
  studioId: string; 
  studioSlug: string; 
  initialData?: any; 
  isEditing?: boolean;
  onComplete: () => void;
}) => {
  const { success, error: toastError } = useToast();
  
  const [step, setStep] = useState<number>(isEditing ? 3 : 1);
  const [selectedType, setSelectedType] = useState<string>(initialData?.eventType || "");
  const [selectedTemplate, setSelectedTemplate] = useState<string>(initialData?.templateId || "");

  const [formData, setFormData] = useState(initialData || {
    customTopTitle: "",
    celebrantName: "",
    groomName: "",
    brideName: "",
    eventType: "Wedding",
    eventDate: "",
    eventTime: "",
    timerTargetTime: "",
    showTimer: true,
    venueName: "",
    venueMapLink: "",
    customInitials: "",
    hideLoaderPhoto: false,
    loaderPhotoUrl: "",
    thumbnailUrl: "",
    invitationVideoUrls: "",
    galleryUrls: "",
    privacyStatus: "Public (Visible Everywhere)",
    youtubePrivacy: "unlisted",
    notes: "",
    templateId: ""
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState<string | null>(null);
  
  // Refs for file uploads
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const loaderPhotoInputRef = useRef<HTMLInputElement>(null);

  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev: typeof formData) => ({ ...prev, [name]: checked }));
    } else {
      setFormData((prev: typeof formData) => ({ ...prev, [name]: value }));
    }
  };

  const handleTypeSelect = (typeId: string) => {
    setSelectedType(typeId);
    setFormData((prev: typeof formData) => ({ ...prev, eventType: typeId }));
    setStep(2);
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    setFormData((prev: typeof formData) => ({ ...prev, templateId }));
    setStep(3);
  };

  const updatePreview = async () => {
    setIsPreviewLoading(true);
    try {
      const res = await fetch('/api/events/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, studioId })
      });
      if (res.ok) {
        const { html } = await res.json();
        setPreviewHtml(html);
      }
    } catch (e) {
      console.error("Preview failed", e);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Preview Update Logic
  useEffect(() => {
    if (step === 3 && formData.templateId) {
      const timer = setTimeout(() => updatePreview(), 1000);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, step]);

  // Upload Logic Wrapper
  const handleUpload = async (files: FileList | null, type: string) => {
    if (!files || files.length === 0) return;
    setIsUploading(type);
    try {
      const folder = studioSlug ? `events/${studioSlug}` : `events/temp`;
      let urls: string[] = [];

      if (type === 'video') {
        urls = await uploadToR2(files, folder);
      } else {
        urls = await uploadImageToCloudinary(files, folder);
      }

      if (type === 'thumbnail') setFormData((p: typeof formData) => ({ ...p, thumbnailUrl: urls[0] }));
      else if (type === 'loaderPhoto') setFormData((p: typeof formData) => ({ ...p, loaderPhotoUrl: urls[0] }));
      else if (type === 'video') {
        const newUrls = urls.join('\n');
        setFormData((p: typeof formData) => ({ ...p, invitationVideoUrls: p.invitationVideoUrls ? `${p.invitationVideoUrls}\n${newUrls}` : newUrls }));
      }
      else if (type === 'gallery') {
        const newUrls = urls.join('\n');
        setFormData((p: typeof formData) => ({ ...p, galleryUrls: p.galleryUrls ? `${p.galleryUrls}\n${newUrls}` : newUrls }));
      }
    } catch (err) {
      console.error(err);
      toastError("Upload failed", "Something went wrong while uploading files.");
    } finally {
      setIsUploading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      // Create Event Logic API Call
      const res = await authFetch('/api/events/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ...formData, 
          isEditing, 
          editingId: initialData?.id,
          // Gallery array formatting expected by backend
          galleryUrls: formData.galleryUrls.split('\n').filter((url: string) => url.trim())
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Generation failed');
      
      success(isEditing ? "Event Updated" : "Event Created", `Successfully saved ${formData.groomName || formData.celebrantName}'s event.`);
      onComplete();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toastError("Error", msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Step 1: Event Type ──────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="w-full py-12 animate-in fade-in zoom-in-95 duration-500">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-black text-[var(--foreground)] tracking-tight">What are you celebrating?</h2>
          <p className="ec-section-sub mt-3">Step 1 of 3 — Select an event category</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {EVENT_TYPES.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                onClick={() => handleTypeSelect(type.id)}
                className="ec-card p-8 flex flex-col items-center justify-center gap-4 hover:border-[var(--primary)] hover:shadow-lg hover:shadow-[var(--primary-subtle)] transition-all group active:scale-95 text-center cursor-pointer"
              >
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${type.bg} ${type.border} border group-hover:scale-110 transition-transform`}>
                  <Icon size={28} className={type.color} />
                </div>
                <h3 className="font-black text-[var(--foreground)] text-lg">{type.label}</h3>
              </button>
            )
          })}
        </div>
      </div>
    );
  }

  // ─── Step 2: Template Gallery ────────────────────────────────────────────
  if (step === 2) {
    const templates = TEMPLATES[selectedType] || TEMPLATES["default"];
    return (
      <div className="w-full py-12 animate-in slide-in-from-right-8 duration-500">
        <div className="flex items-center justify-between mb-12">
          <div>
            <button type="button" onClick={() => setStep(1)} className="ec-btn ec-btn-ghost ec-btn-sm mb-4">
              <ChevronLeft size={16} /> Back to event types
            </button>
            <h2 className="text-3xl font-black text-[var(--foreground)] tracking-tight">Select a Template</h2>
            <p className="ec-section-sub mt-3">Premium designs for {selectedType}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {templates.map((tpl) => (
            <div key={tpl.id} className="ec-card overflow-hidden group cursor-pointer border-2 hover:border-[var(--primary)] transition-all" onClick={() => handleTemplateSelect(tpl.id)}>
              <div className="aspect-[9/16] relative overflow-hidden flex flex-col items-center justify-center gap-4" style={{ background: "var(--surface-hover)", color: "var(--text-tertiary)" }}>
                <Layout size={48} className="opacity-20" />
              <span className="text-xs font-semibold px-6 text-center" style={{ color: "var(--text-secondary)" }}>{tpl.name}</span>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <button className="opacity-0 group-hover:opacity-100 ec-btn bg-[var(--primary)] text-white border-transparent transform translate-y-4 group-hover:translate-y-0 transition-all shadow-xl">
                    Use Template
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Step 3: Form + Preview ──────────────────────────────────────────────
  const isWedding = selectedType === "Wedding" || selectedType === "Engagement" || selectedType === "Reception";

  return (
    <div className="w-full min-h-[85vh] flex flex-col lg:flex-row gap-6 animate-in slide-in-from-right-8 duration-500 pb-10">
      
      {/* LEFT COLUMN: Sectioned Form */}
      <div className="flex-1 lg:max-w-[50%] flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {!isEditing && (
              <button type="button" onClick={() => setStep(2)} className="ec-icon-btn" aria-label="Back">
                <ChevronLeft size={20} />
              </button>
            )}
            <div>
              <h2 className="text-2xl font-black text-[var(--foreground)] tracking-tight">
                {isEditing ? "Edit Event" : "Customize Event"}
              </h2>
              <p className="ec-section-sub mt-1">
                {selectedType} • {formData.templateId}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-6">
          
          {/* Section 1: Basic Details */}
          <div className="ec-card p-6 space-y-6 border-l-4 border-l-blue-500">
            <h3 className="ec-section-title flex items-center gap-2">
              <Globe size={16} className="text-blue-500" /> Event Identity
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="ec-label">Page Top Title (Two Lines)</label>
                <textarea
                  name="customTopTitle"
                  value={formData.customTopTitle}
                  onChange={handleInputChange}
                  rows={2}
                  className="ec-input w-full resize-none"
                  placeholder="e.g. Wedding Invitation"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {isWedding ? (
                  <>
                    <div>
                      <label className="ec-label">Groom&apos;s Name</label>
                      <input type="text" name="groomName" required value={formData.groomName} onChange={handleInputChange} className="ec-input w-full" placeholder="Groom Name" />
                    </div>
                    <div>
                      <label className="ec-label">Bride&apos;s Name</label>
                      <input type="text" name="brideName" required value={formData.brideName} onChange={handleInputChange} className="ec-input w-full" placeholder="Bride Name" />
                    </div>
                  </>
                ) : (
                  <div className="col-span-2">
                    <label className="ec-label">Celebrant Name</label>
                    <input type="text" name="celebrantName" required value={formData.celebrantName} onChange={handleInputChange} className="ec-input w-full" placeholder="Name" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Date & Time */}
          <div className="ec-card p-6 space-y-6 border-l-4 border-l-pink-500">
            <h3 className="ec-section-title flex items-center gap-2">
              <Clock size={16} className="text-pink-500" /> Schedule & Timer
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="ec-label">Event Date</label>
                <input type="date" name="eventDate" required value={formData.eventDate} onChange={handleInputChange} className="ec-input w-full" />
              </div>
              <div>
                <label className="ec-label">Display Time</label>
                <input type="text" name="eventTime" value={formData.eventTime} onChange={handleInputChange} className="ec-input w-full" placeholder="e.g. 10:30 AM onwards" />
              </div>
              <div>
                <label className="ec-label">Timer Target (24h)</label>
                <input type="time" name="timerTargetTime" value={formData.timerTargetTime} onChange={handleInputChange} className="ec-input w-full" />
              </div>
              <div className="flex items-center pt-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" name="showTimer" checked={formData.showTimer} onChange={handleInputChange} className="w-4 h-4 text-pink-600 rounded border-slate-300" />
                  <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Show countdown</span>
                </label>
              </div>
            </div>
          </div>

          {/* Section 3: Venue */}
          <div className="ec-card p-6 space-y-6 border-l-4 border-l-emerald-500">
            <h3 className="ec-section-title flex items-center gap-2">
              <MapPin size={16} className="text-emerald-500" /> Venue Location
            </h3>
            <div className="space-y-4">
              <div>
                <label className="ec-label">Venue Display Name</label>
                <input type="text" name="venueName" value={formData.venueName} onChange={handleInputChange} className="ec-input w-full" placeholder="e.g. Taj Krishna, Banjara Hills" />
              </div>
              <div>
                <label className="ec-label">Google Maps Link</label>
                <input type="text" name="venueMapLink" value={formData.venueMapLink} onChange={handleInputChange} className="ec-input w-full" placeholder="Paste maps URL..." />
              </div>
            </div>
          </div>

          {/* Section 4: Media Assets */}
          <div className="ec-card p-6 space-y-6 border-l-4 border-l-indigo-500">
            <h3 className="ec-section-title flex items-center gap-2">
              <ImageIcon size={16} className="text-indigo-500" /> Media & Uploads
            </h3>
            
            <div className="space-y-6">
              {/* Thumbnail */}
              <div>
                <label className="ec-label flex items-center justify-between">
                  Event Thumbnail
                  {formData.thumbnailUrl && <CheckCircle2 size={14} className="text-emerald-500" />}
                </label>
                <div className="flex gap-2">
                  <input type="text" name="thumbnailUrl" value={formData.thumbnailUrl} onChange={handleInputChange} className="ec-input flex-1" placeholder="URL will appear here..." />
                  <button type="button" onClick={() => thumbInputRef.current?.click()} className="ec-btn ec-btn-secondary shrink-0">
                    {isUploading === 'thumbnail' ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                  </button>
                  <input type="file" ref={thumbInputRef} hidden accept="image/*" onChange={(e) => handleUpload(e.target.files, 'thumbnail')} />
                </div>
              </div>

              {/* Invitation Video */}
              <div>
                <label className="ec-label flex items-center justify-between">
                  Invitation Video (MP4)
                  {formData.invitationVideoUrls && <CheckCircle2 size={14} className="text-emerald-500" />}
                </label>
                <textarea name="invitationVideoUrls" value={formData.invitationVideoUrls} onChange={handleInputChange} rows={2} className="ec-input w-full mb-2 text-sm" placeholder="URLs..." readOnly />
                <button type="button" onClick={() => videoInputRef.current?.click()} className="ec-btn ec-btn-secondary w-full">
                  {isUploading === 'video' ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
                  Upload Video to R2
                </button>
                <input type="file" ref={videoInputRef} hidden accept="video/*" onChange={(e) => handleUpload(e.target.files, 'video')} />
              </div>

              {/* Gallery */}
              <div>
                <label className="ec-label flex items-center justify-between">
                  Photo Gallery
                  {formData.galleryUrls && <CheckCircle2 size={14} className="text-emerald-500" />}
                </label>
                <textarea name="galleryUrls" value={formData.galleryUrls} onChange={handleInputChange} rows={3} className="ec-input w-full mb-2 text-sm" placeholder="Photo URLs..." />
                <button type="button" onClick={() => galleryInputRef.current?.click()} className="ec-btn ec-btn-secondary w-full">
                  {isUploading === 'gallery' ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
                  Upload Photos
                </button>
                <input type="file" ref={galleryInputRef} hidden multiple accept="image/*" onChange={(e) => handleUpload(e.target.files, 'gallery')} />
              </div>
            </div>
          </div>

          <div
            className="sticky bottom-0 z-10 p-4 border-t -mx-6 -mb-6 flex items-center justify-between mt-8 rounded-b-[2rem] gap-4"
            style={{ background: "color-mix(in srgb, var(--background) 92%, transparent)", borderColor: "var(--border-subtle)", backdropFilter: "blur(8px)" }}
          >
            <button type="button" onClick={onComplete} className="ec-btn ec-btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting || isUploading !== null} className="ec-btn ec-btn-lg ec-btn-primary text-white">
              {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
              {isEditing ? "Save Changes" : "Deploy Event"}
            </button>
          </div>
        </form>
      </div>

      {/* RIGHT COLUMN: Live Preview */}
      <div className="flex-1 lg:max-w-[50%] flex flex-col gap-4 sticky top-24 h-[calc(100vh-120px)]">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-[var(--foreground)] tracking-tight flex items-center gap-2">
            <Globe size={16} className="text-[var(--primary)]" /> Live Template Preview
          </h3>
          <button type="button" onClick={updatePreview} className="ec-btn ec-btn-secondary ec-btn-sm">
            <Search size={14} /> Refresh preview
          </button>
        </div>
        
        <div className="flex-1 rounded-[2.5rem] overflow-hidden shadow-inner relative flex items-center justify-center max-w-[400px] mx-auto w-full" style={{ background: "var(--surface-hover)", border: "4px solid var(--border)" }}>
          {isPreviewLoading && (
            <div className="absolute top-4 right-4 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 z-10 shadow-sm" style={{ background: "var(--card)", border: "1px solid var(--border-subtle)" }}>
              <Loader2 className="animate-spin text-[var(--primary)]" size={12} />
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Rendering…</span>
            </div>
          )}
          {previewHtml ? (
            <iframe 
              srcDoc={previewHtml} 
              className="w-full h-full border-none bg-white"
              title="Live Preview"
              sandbox="allow-scripts allow-same-origin"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 text-center px-6" style={{ color: "var(--text-tertiary)" }}>
              <Layout size={48} className="opacity-20" />
              <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>Preview will appear here</p>
              <p className="text-sm mt-2" style={{ color: "var(--text-tertiary)" }}>Fill in details to auto-refresh.</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
