"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { 
  PlusCircle, List, Settings, BarChart3, Image as ImageIcon, Video, Search, 
  MapPin, Clock, Calendar, UploadCloud, Film, Play, CheckCircle2, AlertCircle, 
  Loader2, Link as LinkIcon, X, Layout, Users
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
import { DashboardHome } from "./components/DashboardHome";
import { LiveMonitor } from "./components/LiveMonitor";

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("home"); const [user, setUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
  const [thumbOverlayStyle, setThumbOverlayStyle] = useState<'classic_white' | 'golden' | 'dark_shadow' | 'minimal'>('classic_white');
  const [thumbOverlayPreview, setThumbOverlayPreview] = useState<string>('');

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
    invitationVideoUrls: "",
    thumbnailUrl: "",
    privacyStatus: "Unlisted (Link Only)",
    galleryUrls: "",
    vodLink: "",
    templateId: (typeof window !== 'undefined' ? localStorage.getItem('defaultTemplate') : null) || "wedding-template-01",
    youtubePrivacy: (typeof window !== 'undefined' ? localStorage.getItem('defaultYoutubePrivacy') : null) || "public",
    autoGenerateThumbnail: true,
    customInitials: "",
    hideLoaderPhoto: false,
    loaderPhotoUrl: "",
    notes: ""
  });

  const [hasManuallyEditedInitials, setHasManuallyEditedInitials] = useState(false);
  const [photographerSearchQuery, setPhotographerSearchQuery] = useState("");
  const [selectedPhotographer, setSelectedPhotographer] = useState<any>(null);
  const [showPhotographerList, setShowPhotographerList] = useState(false);
  const [selectedBaseDesign, setSelectedBaseDesign] = useState("ec_premium_pink_v1");
  const [isEditingPhotographer, setIsEditingPhotographer] = useState(false);
  const [editingPhotographerId, setEditingPhotographerId] = useState<string | null>(null);

  const thumbInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const photographerLogoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const loaderPhotoInputRef = useRef<HTMLInputElement>(null);

  const baseDesigns = [
    { id: "base_thumbnails/base_thumbnails/b421a3bc-10fb-4968-87d3-fc7e5902b55a", name: "Floral Classic", font: "Georgia", accentFont: "Times", nameColor: "7D5A50", typeColor: "8E7F7F" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_496fib496fib496f", name: "Modern Blush", font: "Times", accentFont: "Georgia", nameColor: "6D4C41", typeColor: "8D6E63" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_dki6mhdki6mhdki6", name: "Vintage Sage", font: "Georgia", accentFont: "Times", nameColor: "3E4E41", typeColor: "5E6E61" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_h4x887h4x887h4x8", name: "Royal Maroon", font: "Georgia", accentFont: "Times", nameColor: "5D4037", typeColor: "8D6E63" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_nukskenukskenuks", name: "Golden Frame", font: "Times", accentFont: "Georgia", nameColor: "4E342E", typeColor: "6D4C41" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_qkvc8rqkvc8rqkvc", name: "Elegant White", font: "Georgia", accentFont: "Times", nameColor: "424242", typeColor: "757575" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_rc16u6rc16u6rc16", name: "Artistic Pastel", font: "Georgia", accentFont: "Times", nameColor: "5D4037", typeColor: "8D6E63" }
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
      setUser(session.user); setIsAuthLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function fetchEvents() {
    setIsLoadingEvents(true);
    const { data: eventsData, error } = await supabase.from('events').select('*, photographers(name)').order('created_at', { ascending: false });
    const { data: viewsData } = await supabase.from('page_views').select('event_id');
    
    if (eventsData) {
      const viewCounts = (viewsData || []).reduce((acc: any, v: any) => {
        acc[v.event_id] = (acc[v.event_id] || 0) + 1;
        return acc;
      }, {});

      const eventsWithViews = eventsData.map((e: any) => ({
        ...e,
        view_count: viewCounts[e.id] || 0
      }));

      setEvents(eventsWithViews);
      
      const allAssets = eventsWithViews.flatMap(e => [
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
    // Use page_views count per event (accurate, no race condition)
    const { data: eventsData } = await supabase
      .from('events')
      .select('id, groom_name, celebrant_name, bride_name, event_type, slug, event_date')
      .order('created_at', { ascending: false });
    
    const { data: viewsData } = await supabase
      .from('page_views')
      .select('*');
    
    if (eventsData) {
      const viewCounts = (viewsData || []).reduce((acc: any, v: any) => {
        acc[v.event_id] = (acc[v.event_id] || 0) + 1;
        return acc;
      }, {});
      setAnalyticsData(eventsData.map((e: any) => ({
        ...e,
        view_count: viewCounts[e.id] || 0,
        raw_views: (viewsData || []).filter((v: any) => v.event_id === e.id)
      })));
    }
  }

  async function fetchPhotographers() {
    const { data } = await supabase.from('photographers').select('*').order('name');
    if (data) setPhotographers(data);
  }

  const handleInputChange = (e: any) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    if (name === 'customInitials') setHasManuallyEditedInitials(true);
    setFormData(prev => ({ ...prev, [name]: val }));
  };

  // Auto-fill Initials
  useEffect(() => {
    if (!hasManuallyEditedInitials) {
      const groomInitial = (formData.groomName || formData.celebrantName || "").charAt(0).toUpperCase();
      const brideRaw = formData.brideName || "";
      const brideInitial = brideRaw.toLowerCase() !== "family" && brideRaw.toLowerCase() !== "event" ? brideRaw.charAt(0).toUpperCase() : "";
      const autoInitials = groomInitial && brideInitial ? `${groomInitial} & ${brideInitial}` : (groomInitial || brideInitial);
      if (autoInitials !== formData.customInitials) {
        setFormData(prev => ({ ...prev, customInitials: autoInitials }));
      }
    }
  }, [formData.groomName, formData.brideName, formData.celebrantName, hasManuallyEditedInitials]);

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

    if (formData.venueMapLink && !isEditing) {
      const timer = setTimeout(resolveAndExtract, 1000); // Debounce
      return () => clearTimeout(timer);
    }
  }, [formData.venueMapLink, isEditing]);

  const formatDisplayDate = (dateString: string) => {
    if (!dateString) return "Date";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = date.getDate();
    const month = date.toLocaleString('default', { month: 'long' });
    const suffix = ["th", "st", "nd", "rd"][(day % 10 > 3 ? 0 : day % 10) - (day % 100 - day % 10 === 10 ? day % 10 : 0)] || "th";
    return `${day}${suffix} ${month}`;
  };

  const compressImage = async (file: File): Promise<Blob | File> => {
    if (file.type.startsWith('video/')) return file; // Skip for videos
    if (file.size < 2 * 1024 * 1024) return file; // Skip if less than 2MB

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Limit max dimension to 2500px for high quality but reasonable size
          const maxDim = 2500;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height *= maxDim / width;
              width = maxDim;
            } else {
              width *= maxDim / height;
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else resolve(file);
          }, 'image/jpeg', 0.85); // 85% quality is perfect for web
        };
      };
    });
  };

  const handleGenerateThumbnailPreview = () => {
    if (!formData.groomName && !formData.celebrantName) {
      alert("Please enter the Groom or Celebrant name first!");
      return;
    }
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const currentDesign = baseDesigns.find(d => d.id === selectedBaseDesign) || baseDesigns[0];
    
    const formatText = (str: string) => {
      if (!str) return "";
      // Double encode for Cloudinary text overlays
      return encodeURIComponent(str)
        .replace(/%26/g, "%2526")
        .replace(/%2C/g, "%252C")
        .replace(/\//g, "%252F")
        .replace(/\?/g, "%253F");
    };
    
    const groom = formatText(formData.groomName || formData.celebrantName || "Groom");
    const bride = formatText(formData.brideName || "");
    const eventTypeText = formatText(`${formData.eventType} Live`);
    
    // Premium AI-Style Layout with Shadows
    let transformations = `w_1280,h_720,c_fill/`;
    
    // Layer 1: Groom Name with shadow
    transformations += `co_rgb:${currentDesign.nameColor},e_shadow:40,x_2,y_2,l_text:Georgia_75_bold:${groom}/g_center,y_-110,fl_layer_apply/`;
    
    if (bride) {
      // Ampersand with shadow
      transformations += `co_rgb:${currentDesign.nameColor},e_shadow:30,l_text:Times_60:${formatText("&")}/g_center,y_-40,fl_layer_apply/`;
      // Bride Name with shadow
      transformations += `co_rgb:${currentDesign.nameColor},e_shadow:40,x_2,y_2,l_text:Georgia_75_bold:${bride}/g_center,y_30,fl_layer_apply/`;
    }
    
    // Layer 4: Event Type with shadow
    transformations += `co_rgb:${currentDesign.typeColor},e_shadow:20,l_text:Arial_55:${eventTypeText}/g_center,y_140,fl_layer_apply/`;
    
    // Add timestamp for cache busting
    const generatedUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${transformations}f_auto,q_auto/${currentDesign.id}.jpg?v=${Date.now()}`;

    console.log("Generated Thumbnail URL:", generatedUrl);
    setFormData(prev => ({ ...prev, thumbnailUrl: generatedUrl }));
  };

  async function uploadToCloudinary(files: FileList | null, type: string) {
    if (!files || files.length === 0) return;
    setIsUploading(type);
    const uploadedUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      let fileToUpload: File | Blob = files[i];
      
      // Auto-compress high-res images BEFORE sending to Cloudinary
      if (type !== 'video') {
        fileToUpload = await compressImage(files[i]);
      }

      const formDataUpload = new FormData();
      formDataUpload.append('file', fileToUpload);
      formDataUpload.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'eventcast_gallery');

      try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/auto/upload`, {
          method: 'POST',
          body: formDataUpload
        });
        const data = await res.json();
        
        if (data.secure_url) {
          let optimizedUrl = data.secure_url;
          // Apply Cloudinary's dynamic Auto-Format & Auto-Quality flags for blazing fast delivery
          if (data.resource_type === 'image') {
            optimizedUrl = optimizedUrl.replace('/upload/', '/upload/f_auto,q_auto/');
          }
          uploadedUrls.push(optimizedUrl);
        }
      } catch (err) {
        console.error("Upload error:", err);
      }
    }

    if (type === 'thumbnail') setFormData(prev => ({ ...prev, thumbnailUrl: uploadedUrls[0] }));
    else if (type === 'video') {
      const newUrls = uploadedUrls.join('\n');
      setFormData(prev => ({ ...prev, invitationVideoUrls: prev.invitationVideoUrls ? `${prev.invitationVideoUrls}\n${newUrls}` : newUrls }));
    }
    else if (type === 'photographer_logo') setSelectedPhotographer((prev: any) => ({ ...prev, logo_url: uploadedUrls[0] }));
    else if (type === 'loaderPhoto') setFormData(prev => ({ ...prev, loaderPhotoUrl: uploadedUrls[0] }));
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
      let finalThumbnailUrl = formData.thumbnailUrl;
      
      if (formData.autoGenerateThumbnail && !finalThumbnailUrl) {
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const currentDesign = baseDesigns.find(d => d.id === selectedBaseDesign) || baseDesigns[0];
        
        const formatText = (str: string) => {
          if (!str) return "";
          return encodeURIComponent(str).replace(/%26/g, "%2526").replace(/%2C/g, "%252C");
        };
        const groom = formatText(formData.groomName || formData.celebrantName || "Groom");
        const bride = formatText(formData.brideName || "");
        const eventTypeText = formatText(`${formData.eventType} Live`);
        
        let transformations = `w_1280,h_720,c_fill/`;
        transformations += `co_rgb:${currentDesign.nameColor},e_shadow:40,l_text:${currentDesign.font}_75_bold:${groom}/g_center,y_-110,fl_layer_apply/`;
        if (bride) {
          transformations += `co_rgb:${currentDesign.nameColor},e_shadow:30,l_text:${currentDesign.accentFont}_60:${formatText("&")}/g_center,y_-40,fl_layer_apply/`;
          transformations += `co_rgb:${currentDesign.nameColor},e_shadow:40,l_text:${currentDesign.font}_75_bold:${bride}/g_center,y_30,fl_layer_apply/`;
        }
        transformations += `co_rgb:${currentDesign.typeColor},e_shadow:20,l_text:Arial_55:${eventTypeText}/g_center,y_140,fl_layer_apply/`;
        
        finalThumbnailUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${transformations}f_auto,q_auto/${currentDesign.id}.jpg`;
      }


      let youtubeDetails = null;
      if (!isEditing && formData.youtubePrivacy !== 'none') {
        try {
          const ytRes = await fetch('/api/youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              groomName: formData.groomName,
              brideName: formData.brideName,
              celebrantName: formData.celebrantName,
              eventType: formData.eventType,
              eventDate: formData.eventDate,
              targetTime: formData.timerTargetTime || formData.eventTime, // Live Start Time first, fallback to muhurtham
              venueName: formData.venueName,
              thumbnailUrl: finalThumbnailUrl,
              privacy: formData.youtubePrivacy
            })
          });
          const ytData = await ytRes.json();
          if (ytData.success) {
            youtubeDetails = ytData;
          }
        } catch (ytErr) {
          console.error("YouTube Automation Failed:", ytErr);
        }
      }

      const payload = {
        ...formData,
        thumbnailUrl: finalThumbnailUrl,
        photographerId: selectedPhotographer?.id,
        galleryUrls: formData.galleryUrls.split('\n').filter(url => url.trim()),
        baseDesign: selectedBaseDesign,
        vodLink: youtubeDetails?.youtubeUrl || formData.vodLink,
        youtube_broadcast_id: youtubeDetails?.broadcastId,
        youtube_stream_key: youtubeDetails?.streamKey,
        youtube_url: youtubeDetails?.youtubeUrl
      };

      const res = await fetch('/api/events/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, isEditing, editingId })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      if (youtubeDetails) {
        setSubmitStatus({ type: 'success', message: `Site Generated & YouTube Event Created Successfully!` });
      }

      setSubmitStatus({ type: 'success', message: `Success! Event ${isEditing ? 'Updated' : 'Created'}.` });
      resetForm();
      fetchEvents();
    } catch (err: any) {
      const errorMsg = err.message.includes("base_design") || err.message.includes("notes")
        ? "Database Error: Please run the SQL command to add 'base_design' and 'notes' columns to your 'events' table in Supabase."
        : err.message;
      setSubmitStatus({ type: 'error', message: errorMsg });
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
      invitationVideoUrls: "",
      thumbnailUrl: "",
      privacyStatus: "Unlisted (Link Only)",
      galleryUrls: "",
      vodLink: "",
      templateId: (typeof window !== 'undefined' ? localStorage.getItem('defaultTemplate') : null) || "wedding-template-01",
      youtubePrivacy: (typeof window !== 'undefined' ? localStorage.getItem('defaultYoutubePrivacy') : null) || "public",
      autoGenerateThumbnail: true,
      customInitials: "",
      hideLoaderPhoto: false,
      loaderPhotoUrl: "",
      notes: ""
    });
    setHasManuallyEditedInitials(false);
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
      invitationVideoUrls: Array.isArray(event.invitation_video_url)
        ? event.invitation_video_url.join('\n')
        : (event.invitation_video_url || ""),
      thumbnailUrl: event.thumbnail_url || "",
      privacyStatus: event.privacy_status || "Unlisted (Link Only)",
      galleryUrls: Array.isArray(event.gallery_urls) ? event.gallery_urls.join('\n') : "",
      vodLink: event.vod_link || "",
      templateId: event.template_id || "wedding-template-01",
      youtubePrivacy: "public",
      autoGenerateThumbnail: event.auto_generate_thumbnail ?? true,
      customInitials: event.custom_initials || "",
      hideLoaderPhoto: event.hide_loader_photo || false,
      loaderPhotoUrl: event.loader_photo_url || "",
      notes: event.notes || ""
    });
    // Always set true when editing so auto-fill doesn't wipe existing values
    setHasManuallyEditedInitials(true);
    const pg = photographers.find((p: any) => p.id === event.photographer_id);
    if (pg) setSelectedPhotographer(pg);
    // Restore base design selection if available
    if (event.base_design) setSelectedBaseDesign(event.base_design);
    setActiveTab("create");
  };

  const handleDuplicateClick = (event: any) => {
    setIsEditing(false);
    setEditingId(null);
    setFormData({
      eventType: event.event_type || "Wedding",
      groomName: (event.groom_name || "") + " (Copy)",
      brideName: event.bride_name || "",
      celebrantName: (event.celebrant_name || "") + " (Copy)",
      customTopTitle: event.custom_top_title || "",
      eventDate: event.event_date || "",
      eventTime: event.event_time || "",
      timerTargetTime: event.timer_target_time || "",
      showTimer: event.show_timer ?? true,
      venueName: event.venue_name || "",
      venueMapLink: event.venue_map_link || "",
      invitationVideoUrls: Array.isArray(event.invitation_video_url)
        ? event.invitation_video_url.join('\n')
        : (event.invitation_video_url || ""),
      thumbnailUrl: event.thumbnail_url || "",
      privacyStatus: event.privacy_status || "Unlisted (Link Only)",
      galleryUrls: Array.isArray(event.gallery_urls) ? event.gallery_urls.join('\n') : "",
      vodLink: "", // Do not copy vodLink or youtube stream details
      templateId: event.template_id || "wedding-template-01",
      youtubePrivacy: "public",
      autoGenerateThumbnail: event.auto_generate_thumbnail ?? true,
      customInitials: event.custom_initials || "",
      hideLoaderPhoto: event.hide_loader_photo || false,
      loaderPhotoUrl: event.loader_photo_url || "",
      notes: event.notes || ""
    });
    setHasManuallyEditedInitials(!!event.custom_initials);
    const pg = photographers.find((p: any) => p.id === event.photographer_id);
    if (pg) setSelectedPhotographer(pg);
    if (event.base_design) setSelectedBaseDesign(event.base_design);
    setActiveTab("create");
  };

  async function fullDeleteEvent(id: string) {
    if (!confirm("Are you sure?")) return;
    setIsLoadingEvents(true);
    try {
      const res = await fetch('/api/events/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete event.");
      }
      
      alert("✅ Event and all related data deleted successfully!");
      fetchEvents();
    } catch (err: any) {
      console.error("Delete error:", err);
      alert(`❌ Delete failed: ${err.message}`);
    } finally {
      setIsLoadingEvents(false);
    }
  }

  async function deleteMultipleEvents(ids: string[]) {
    setIsLoadingEvents(true);
    try {
      const results = await Promise.all(ids.map(id => 
        fetch('/api/events/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        }).then(res => res.json())
      ));
      
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        alert(`${failed.length} events failed to delete. ${results.length - failed.length} succeeded.`);
      } else {
        alert(`✅ All ${ids.length} events deleted successfully.`);
      }
      fetchEvents();
    } catch (err) {
      console.error("Bulk delete error:", err);
      alert("❌ Bulk delete failed.");
    } finally {
      setIsLoadingEvents(false);
    }
  }

  async function addPhotographer(e: any) {
    e.preventDefault();
    setIsSubmitting(true);
    const fd = new FormData(e.target);
    const photographerData = {
      nickname: fd.get('nickname') || null,
      name: fd.get('name') || null,
      phone_number: fd.get('phone') || null,
      city: fd.get('city') || null,
      logo_url: fd.get('logo_url') || null,
      instagram_url: fd.get('instagram_url') || null
    };

    try {
      if (isEditingPhotographer && editingPhotographerId) {
        const { error } = await supabase
          .from('photographers')
          .update(photographerData)
          .eq('id', editingPhotographerId);
        
        if (error) throw error;
        alert("Photographer updated successfully!");
      } else {
        const { error } = await supabase.from('photographers').insert(photographerData);
        if (error) throw error;
        alert("Photographer added successfully!");
      }
      
      e.target.reset();
      setIsEditingPhotographer(false);
      setEditingPhotographerId(null);
      fetchPhotographers();
    } catch (error: any) {
      console.error("Photographer Action Error:", error);
      alert("Action failed: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleEditPhotographer = (pg: any) => {
    setIsEditingPhotographer(true);
    setEditingPhotographerId(pg.id);
    // Manually fill form fields
    const form = document.querySelector('form') as HTMLFormElement; // Note: This might need more specific selector if multiple forms
    if (form) {
      (form.elements.namedItem('name') as HTMLInputElement).value = pg.name || "";
      (form.elements.namedItem('phone') as HTMLInputElement).value = pg.phone_number || "";
      (form.elements.namedItem('city') as HTMLInputElement).value = pg.city || "";
      (form.elements.namedItem('logo_url') as HTMLInputElement).value = pg.logo_url || "";
      (form.elements.namedItem('instagram_url') as HTMLInputElement).value = pg.instagram_url || "";
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  async function deletePhotographer(id: string) {
    if (!confirm("Are you sure you want to delete this photographer credit? This will not affect existing events but they will lose the photographer info in future edits.")) return;
    try {
      const { error } = await supabase.from('photographers').delete().eq('id', id);
      if (error) throw error;
      alert("Photographer deleted!");
      fetchPhotographers();
    } catch (err: any) {
      alert("Delete failed: " + err.message);
    }
  }

  function getVideoThumbnail(url: string) {
    if (url.includes('cloudinary.com')) {
      return url.replace(/\.(mp4|mov|avi)$/, '.jpg');
    }
    return null;
  }

  if (isAuthLoading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" size={48} /></div>;

  async function handlePasswordUpdate(e: any) {
    e.preventDefault();
    const currentPassword = e.target.currentPassword.value;
    const newPassword = e.target.newPassword.value;
    const confirmPassword = e.target.confirmPassword.value;
    if (newPassword !== confirmPassword) {
      alert("New passwords do not match!");
      return;
    }
    if (newPassword.length < 8) {
      alert("New password must be at least 8 characters.");
      return;
    }
    setIsSubmitting(true);
    // Step 1: Verify current password by re-authenticating
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user?.email || '',
      password: currentPassword,
    });
    if (authError) {
      alert("❌ Current password is incorrect. Please try again.");
      setIsSubmitting(false);
      return;
    }
    // Step 2: Update to new password
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      alert("Update failed: " + error.message);
    } else {
      alert("✅ Password updated successfully! Please re-login on all devices.");
      e.target.reset();
      // Sign out all other sessions by signing out and back in
      await supabase.auth.signOut({ scope: 'others' });
    }
    setIsSubmitting(false);
  }

  const generateThumbWithNames = () => {
    if (!formData.thumbnailUrl) return;
    if (!formData.groomName && !formData.celebrantName) {
      alert('Please enter names first!');
      return;
    }
    // Extract Cloudinary public_id from URL
    const url = formData.thumbnailUrl;
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    if (!url.includes('cloudinary.com')) {
      alert('Only works with Cloudinary-uploaded images. Upload the photo first.');
      return;
    }
    const uploadSegment = url.split('/upload/')[1];
    if (!uploadSegment) return;
    // Strip any existing transformations — find the public_id part (after the last transform)
    const segments = uploadSegment.split('/');
    // Cloudinary transforms are segments matching x_y or x_y,z_w patterns
    const transformPat = /^[a-zA-Z]+_[^/,]+([,][a-zA-Z]+_[^/,]+)*$/;
    let idSegments: string[] = [];
    let pastTransforms = false;
    for (const seg of segments) {
      if (!pastTransforms && transformPat.test(seg)) continue;
      pastTransforms = true;
      idSegments.push(seg);
    }
    const publicId = idSegments.join('/').replace(/\.[^.]+$/, ''); // remove extension

    const fmt = (s: string) => encodeURIComponent(s).replace(/%2C/g, '%252C').replace(/%26/g, '%2526').replace(/%2F/g, '%252F');
    const groomText = fmt(formData.groomName || formData.celebrantName || '');
    const brideText = fmt(formData.brideName || '');

    const styles: Record<string, { nameColor: string; groomFont: string; brideFont: string; yGroom: string; yBride: string; shadow: string; overlay: string }> = {
      classic_white: { nameColor: 'FFFFFF', groomFont: 'Georgia_70_bold', brideFont: 'Georgia_55_italic', yGroom: '-80', yBride: '-20', shadow: 'e_shadow:50', overlay: '' },
      golden:        { nameColor: 'F5C842', groomFont: 'Georgia_72_bold', brideFont: 'Georgia_58_italic', yGroom: '-80', yBride: '-20', shadow: 'e_shadow:40', overlay: 'e_brightness:-20,' },
      dark_shadow:   { nameColor: '1A1A1A', groomFont: 'Georgia_70_bold', brideFont: 'Georgia_55_italic', yGroom: '80', yBride: '140', shadow: 'e_shadow:60', overlay: '' },
      minimal:       { nameColor: 'F0EDE6', groomFont: 'Arial_65_bold', brideFont: 'Arial_50', yGroom: '-60', yBride: '5', shadow: '', overlay: '' },
    };
    const s = styles[thumbOverlayStyle];

    let transforms = `w_1280,h_720,c_fill/`;
    if (s.overlay) transforms += `${s.overlay}/`;
    // Dark semi-transparent gradient overlay at bottom for readability (for classic & golden)
    if (thumbOverlayStyle === 'classic_white' || thumbOverlayStyle === 'golden') {
      transforms += `e_gradient_fade:symmetric_pad,x_0.5,y_0.4,b_rgb:000000/`;
    }
    transforms += `co_rgb:${s.nameColor},${s.shadow ? s.shadow + ',' : ''}l_text:${s.groomFont}:${groomText}/g_south,y_${s.yGroom},fl_layer_apply/`;
    if (brideText) {
      const amp = fmt('& ');
      transforms += `co_rgb:${s.nameColor},l_text:${s.brideFont}:${amp}${brideText}/g_south,y_${s.yBride},fl_layer_apply/`;
    }
    transforms += `f_auto,q_auto/`;

    const previewUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${transforms}${publicId}.jpg?v=${Date.now()}`;
    setThumbOverlayPreview(previewUrl);
  };

  const filteredPhotographers = photographers.filter(p => {
    const q = photographerSearchQuery.toLowerCase();
    return (
      (p.nickname || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.phone_number || '').toLowerCase().includes(q) ||
      (p.city || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        handleSignOut={handleSignOut} 
      />

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        {activeTab === "home" && (
          <DashboardHome 
            events={events} 
            wishes={wishes} 
            analyticsData={analyticsData} 
            setActiveTab={setActiveTab} 
          />
        )}
        {activeTab === "monitor" && <LiveMonitor events={events} wishes={wishes} />}
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
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                        Intro Text (Press Enter for 2nd line)
                      </label>
                      <textarea
                        name="customTopTitle"
                        value={formData.customTopTitle}
                        onChange={handleInputChange}
                        rows={2}
                        placeholder={"e.g. Somisetty & Parchuri's\nWedding Invitation"}
                        className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800 resize-none"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation(); // Prevent form submit
                            // Allow default textarea newline behavior
                          }
                        }}
                      />
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Event Type</label>
                      <select name="eventType" value={formData.eventType} onChange={handleInputChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800 appearance-none">
                        <option>Wedding</option>
                        <option>Engagement</option>
                        <option>Reception</option>
                        <option>Birthday</option>
                        <option>Half Saree</option>
                      </select>
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Visual Template</label>
                      <select name="templateId" value={formData.templateId} onChange={handleInputChange} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800 appearance-none">
                        <option value="wedding-template-01">wedding-template-01 (Premium Pink & Gold)</option>
                        <option value="wedding-template">wedding-template (Modern Sage Theme)</option>
                        <option value="wedding">wedding (Traditional Maroon)</option>
                      </select>
                    </div>
                    {(formData.eventType === "Wedding" || formData.eventType === "Engagement" || formData.eventType === "Reception") ? (
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

                {/* 1.5. Loader & Branding */}
                <section>
                  <h3 className="text-lg font-black text-slate-800 border-b border-slate-100 pb-4 mb-8 flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center"><Layout size={18} /></div>
                    Loader & Branding
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Custom Initials (Optional)</label>
                      <input 
                        type="text" 
                        name="customInitials" 
                        value={formData.customInitials} 
                        onChange={handleInputChange} 
                        placeholder={`e.g. A & N (Auto-generated if empty)`}
                        className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" 
                      />
                    </div>
                    <div className="flex flex-col justify-center">
                      <div className="flex items-center mb-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input 
                            type="checkbox" 
                            name="hideLoaderPhoto" 
                            checked={formData.hideLoaderPhoto} 
                            onChange={handleInputChange} 
                            className="w-5 h-5 rounded text-blue-600" 
                          />
                          <div>
                            <span className="block text-sm font-bold text-slate-800">Hide Loader Photo</span>
                            <span className="block text-xs text-slate-500">Only show initials in the center circle</span>
                          </div>
                        </label>
                      </div>
                      
                      {!formData.hideLoaderPhoto && (
                        <div>
                          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Manual Loader Photo (Optional)</label>
                          <div className="relative group">
                            <input
                              type="text"
                              name="loaderPhotoUrl"
                              value={formData.loaderPhotoUrl}
                              onChange={handleInputChange}
                              placeholder="Leave empty to auto-use Thumbnail/Gallery"
                              className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all pr-12 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => loaderPhotoInputRef.current?.click()}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                              {isUploading === 'loaderPhoto' ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                            </button>
                            <input
                              type="file"
                              ref={loaderPhotoInputRef}
                              onChange={(e) => uploadToCloudinary(e.target.files, 'loaderPhoto')}
                              accept="image/*"
                              className="hidden"
                            />
                          </div>
                          {formData.loaderPhotoUrl && (
                            <div className="mt-2 text-xs text-green-600 font-bold flex items-center gap-1">
                              <CheckCircle2 size={14} /> Custom loader photo uploaded
                            </div>
                          )}
                        </div>
                      )}
                    </div>
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
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                        {formData.eventType === "Reception" ? "Reception Time" : formData.eventType === "Wedding" || formData.eventType === "Engagement" ? "Sumuhurtham Time" : "Ceremony Time"}
                      </label>
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
                      <div className="relative group">
                        <input
                          type="text"
                          name="thumbnailUrl"
                          value={formData.thumbnailUrl}
                          onChange={handleInputChange}
                          placeholder="Paste thumbnail image URL here..."
                          className="w-full bg-white/50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400 pr-12"
                        />
                        <button
                          type="button"
                          onClick={() => thumbInputRef.current?.click()}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                        >
                          <UploadCloud size={18} />
                        </button>
                        <input type="file" ref={thumbInputRef} hidden accept="image/*" onChange={(e) => uploadToCloudinary(e.target.files, 'thumbnail')} />
                      </div>
                      {formData.thumbnailUrl && (
                        <div className="mt-4 space-y-3">
                          <div className="p-2 bg-slate-50 border border-slate-100 rounded-2xl">
                            <img src={formData.thumbnailUrl} alt="Thumbnail Preview" className="w-full h-32 object-cover rounded-xl" />
                          </div>
                          {/* ✨ Names on Photo Designer */}
                          {formData.thumbnailUrl.includes('cloudinary.com') && (formData.groomName || formData.celebrantName) && (
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
                              <p className="text-xs font-black text-amber-800 uppercase tracking-widest flex items-center gap-2">
                                ✨ Add Names to Your Photo
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                {[['classic_white','☁️ Classic White'], ['golden','✨ Golden'], ['dark_shadow','🖤 Dark Text'], ['minimal','🤍 Minimal']].map(([val, label]) => (
                                  <button key={val} type="button"
                                    onClick={() => setThumbOverlayStyle(val as any)}
                                    className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all ${
                                      thumbOverlayStyle === val
                                        ? 'bg-amber-600 text-white border-amber-600 shadow-md'
                                        : 'bg-white text-amber-700 border-amber-200 hover:border-amber-400'
                                    }`}
                                  >{label}</button>
                                ))}
                              </div>
                              <button type="button" onClick={generateThumbWithNames}
                                className="w-full py-2.5 bg-amber-600 text-white rounded-xl text-sm font-black hover:bg-amber-700 transition-colors flex items-center justify-center gap-2"
                              >
                                🪄 Generate Preview
                              </button>
                              {thumbOverlayPreview && (
                                <div className="space-y-2">
                                  <img src={thumbOverlayPreview} alt="Name Overlay Preview" className="w-full rounded-xl border-2 border-amber-300 shadow-md" />
                                  <button type="button"
                                    onClick={() => { setFormData(prev => ({ ...prev, thumbnailUrl: thumbOverlayPreview })); setThumbOverlayPreview(''); }}
                                    className="w-full py-2 bg-green-600 text-white rounded-xl text-xs font-black hover:bg-green-700 transition-colors"
                                  >
                                    ✅ Use This as Thumbnail
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                        Invitation Videos (MP4) <span className="normal-case font-normal text-slate-400">— upload 1, 2 or 3 videos</span>
                      </label>
                      <textarea
                        name="invitationVideoUrls"
                        value={formData.invitationVideoUrls}
                        onChange={handleInputChange}
                        rows={2}
                        className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-mono text-xs mb-2 text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                        placeholder="Video URLs will appear here after upload (one per line)..."
                        readOnly
                      />
                      <button
                        type="button"
                        onClick={() => videoInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 font-bold transition-colors"
                      >
                        {isUploading === 'video' ? <Loader2 className="animate-spin" size={18} /> : <Film size={18} />}
                        Upload Invitation Video(s)
                      </button>
                      <input type="file" ref={videoInputRef} hidden multiple accept="video/*" onChange={(e) => uploadToCloudinary(e.target.files, 'video')} />
                      {formData.invitationVideoUrls && (
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          {formData.invitationVideoUrls.split('\n').filter(u => u.trim()).map((url, idx) => (
                            <div key={idx} className="relative group">
                              <video src={url.trim()} className="w-full h-24 object-cover rounded-xl border border-slate-200 bg-slate-100" muted playsInline />
                              <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-xl">
                                <span className="text-white font-black text-xs">Video {idx + 1}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const urls = formData.invitationVideoUrls.split('\n').filter(u => u.trim());
                                  urls.splice(idx, 1);
                                  setFormData(prev => ({ ...prev, invitationVideoUrls: urls.join('\n') }));
                                }}
                                className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >✕</button>
                            </div>
                          ))}
                        </div>
                      )}
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
                      {formData.galleryUrls && (
                        <div className="mt-4 grid grid-cols-4 sm:grid-cols-6 gap-2 p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                          {formData.galleryUrls.split('\n').filter(url => url.trim()).map((url, idx) => (
                            <img key={idx} src={url.trim()} alt={`Gallery Preview ${idx + 1}`} className="w-full aspect-square object-cover rounded-lg border border-slate-200" />
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {formData.autoGenerateThumbnail && (
                      <div className="md:col-span-2 bg-blue-50/50 p-6 rounded-2xl border border-blue-100 mt-2">
                        <label className="block text-sm font-black text-blue-800 mb-4 flex items-center gap-2">
                          <ImageIcon size={18} /> Choose Your Base Design
                        </label>
                        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
                          {baseDesigns.map((design) => (
                            <button
                              key={design.id}
                              type="button"
                              onClick={() => setSelectedBaseDesign(design.id)}
                              className={`flex-shrink-0 w-36 group relative rounded-xl overflow-hidden border-4 transition-all ${
                                selectedBaseDesign === design.id ? 'border-blue-500 shadow-md scale-105' : 'border-transparent hover:border-blue-200'
                              }`}
                            >
                              <img 
                                src={`https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload/w_300,h_180,c_fill,f_auto,q_auto/${design.id}.jpg`} 
                                alt={design.name}
                                className="w-full h-24 object-cover"
                              />
                              <div className={`absolute bottom-0 inset-x-0 p-1.5 text-[9px] font-black tracking-wider text-center uppercase ${
                                selectedBaseDesign === design.id ? 'bg-blue-500 text-white' : 'bg-black/60 text-white backdrop-blur-sm'
                              }`}>
                                {design.name}
                              </div>
                            </button>
                          ))}
                        </div>
                        <button type="button" onClick={handleGenerateThumbnailPreview} className="mt-4 w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                          <ImageIcon size={18} /> Generate Thumbnail Preview
                        </button>
                        <p className="text-[10px] text-blue-600 font-medium mt-3 text-center">Click the button above to render the names and see the preview below!</p>
                      </div>
                    )}
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
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Photography Details</label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search by nickname, studio, phone, city..."
                          value={selectedPhotographer ? `${selectedPhotographer.nickname ? selectedPhotographer.nickname + ' — ' : ''}${selectedPhotographer.name || ''}` : photographerSearchQuery}
                          onChange={(e) => { setPhotographerSearchQuery(e.target.value); setSelectedPhotographer(null); setShowPhotographerList(true); }}
                          onFocus={() => setShowPhotographerList(true)}
                          className="w-full p-4 pl-12 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-800"
                        />
                        <Search className="absolute left-4 top-4 text-slate-400" size={20} />
                        {selectedPhotographer && (
                          <button type="button" onClick={() => { setSelectedPhotographer(null); setPhotographerSearchQuery(''); }} className="absolute right-4 top-4 text-slate-400 hover:text-red-500">
                            ✕
                          </button>
                        )}
                        {showPhotographerList && photographerSearchQuery && !selectedPhotographer && (
                          <div className="absolute z-20 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl max-h-64 overflow-y-auto">
                            {filteredPhotographers.length === 0 ? (
                              <div className="p-4 text-center text-slate-400 text-sm">No results found</div>
                            ) : filteredPhotographers.map(p => (
                              <button key={p.id} type="button" onClick={() => { setSelectedPhotographer(p); setShowPhotographerList(false); }} className="w-full p-4 hover:bg-blue-50 text-left border-b border-slate-50 transition-colors">
                                <div className="flex items-center gap-3">
                                  {p.logo_url ? (
                                    <img src={p.logo_url} className="w-10 h-10 object-contain rounded-lg border border-slate-100 p-1 bg-white" alt={p.name} />
                                  ) : (
                                    <div className="w-10 h-10 bg-blue-600 text-white rounded-lg flex items-center justify-center font-black text-sm">
                                      {(p.nickname || p.name || '?')[0].toUpperCase()}
                                    </div>
                                  )}
                                  <div>
                                    {p.nickname && <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">{p.nickname}</p>}
                                    <p className="font-bold text-slate-800 text-sm">{p.name || <span className="italic text-slate-400">No studio name</span>}</p>
                                    <p className="text-[10px] text-slate-400">{[p.phone_number, p.city].filter(Boolean).join(' • ')}</p>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {selectedPhotographer && (
                        <div className="mt-2 p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-center gap-3">
                          {selectedPhotographer.logo_url && <img src={selectedPhotographer.logo_url} className="w-8 h-8 object-contain rounded" alt="" />}
                          <div>
                            <p className="text-xs font-black text-blue-800">{selectedPhotographer.name || 'Photographer'}</p>
                            <p className="text-[10px] text-blue-500">{[selectedPhotographer.phone_number, selectedPhotographer.city].filter(Boolean).join(' • ')}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* 6. Internal Metadata */}
                <section>
                  <h3 className="text-lg font-black text-slate-800 border-b border-slate-100 pb-4 mb-8 flex items-center gap-3">
                    <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center"><Layout size={18} /></div>
                    Internal Metadata
                  </h3>
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Internal Event Notes</label>
                    <textarea 
                      placeholder="Add private notes for the team (e.g. 'Customer requested extra focus on group photos', 'Payment pending', etc.)"
                      value={formData.notes}
                      onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                      className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-800 h-32 resize-none"
                    />
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
                        {formData.groomName || formData.celebrantName || "Couple Names"} & {formData.brideName || "Family"} {formData.eventType} | {formatDisplayDate(formData.eventDate)}
                      </h4>
                      <p className="text-xs text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                        Join us live for the {formData.eventType} of {formData.groomName || formData.celebrantName || "Name"} & {formData.brideName || "Family"} on {formatDisplayDate(formData.eventDate)}. Venue: {formData.venueName || "Location Name"}.
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
                    {isSubmitting ? (isEditing ? "Updating Event..." : "Creating Event...") : (isEditing ? "💾 Save & Update Event" : "🚀 Create Event")}
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

        {activeTab === "list" && (
          <EventTable 
            events={events} 
            wishes={wishes}
            isLoadingEvents={isLoadingEvents} 
            fetchEvents={fetchEvents} 
            handleEditClick={handleEditClick} 
            handleDuplicateClick={handleDuplicateClick}
            fullDeleteEvent={fullDeleteEvent} 
            deleteMultipleEvents={deleteMultipleEvents}
          />
        )}
        {activeTab === "moderation" && <WishesModeration wishes={wishes} isLoadingWishes={isLoadingWishes} fetchWishes={fetchWishes} deleteWish={fetchWishes} />}
        {activeTab === "analytics" && <AnalyticsDashboard analyticsData={analyticsData} />}
        {activeTab === "assets" && <AssetLibrary assetLibrary={assetLibrary} getVideoThumbnail={getVideoThumbnail} setSelectedAsset={setSelectedAsset} />}
        {activeTab === "settings" && (
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="bg-white p-10 rounded-3xl shadow-sm border border-slate-200">
              <h2 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-3">
                <Settings size={28} className="text-blue-600" /> Account Security
              </h2>
              <div className="mb-6 p-4 bg-blue-50 rounded-2xl border border-blue-100 text-blue-700 text-xs font-bold">
                🔐 Sessions: Supabase keeps you logged in using a secure refresh token (stored in browser). Your session is valid until you explicitly sign out or change password. After changing password, all other devices will be signed out automatically.
              </div>
              <form onSubmit={handlePasswordUpdate} className="space-y-6">
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Current Password <span className="text-red-500">*</span></label>
                  <input type="password" name="currentPassword" required placeholder="Enter your current password to verify identity" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">New Password</label>
                  <input type="password" name="newPassword" required minLength={8} placeholder="Minimum 8 characters" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Confirm New Password</label>
                  <input type="password" name="confirmPassword" required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-800" />
                </div>
                <button type="submit" disabled={isSubmitting} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black hover:bg-slate-800 transition-all disabled:bg-slate-300">
                  {isSubmitting ? "Verifying & Updating..." : "🔒 Change Password (Signs Out Other Devices)"}
                </button>
              </form>
            </div>

            <div className="bg-white p-10 rounded-3xl shadow-sm border border-slate-200">
              <h3 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-3">
                <Layout size={24} className="text-blue-600" /> Default Event Settings
              </h3>
              <p className="text-slate-500 text-sm mb-8 font-medium">Set your preferred defaults for every new event you create.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Default Template</label>
                  <select 
                    id="defaultTemplate"
                    className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-800"
                    defaultValue={typeof window !== 'undefined' ? localStorage.getItem('defaultTemplate') || 'wedding-template-01' : 'wedding-template-01'}
                    onChange={(e) => localStorage.setItem('defaultTemplate', e.target.value)}
                  >
                    <option value="wedding-template-01">Wedding Template v1</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Default YouTube Privacy</label>
                  <select 
                    id="defaultYoutubePrivacy"
                    className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-800"
                    defaultValue={typeof window !== 'undefined' ? localStorage.getItem('defaultYoutubePrivacy') || 'public' : 'public'}
                    onChange={(e) => localStorage.setItem('defaultYoutubePrivacy', e.target.value)}
                  >
                    <option value="public">Public (Everyone)</option>
                    <option value="unlisted">Unlisted (Link Only)</option>
                  </select>
                </div>
              </div>
              <div className="mt-8 p-4 bg-blue-50 rounded-2xl border border-blue-100 text-blue-700 text-xs font-bold">
                ✨ These settings will be automatically applied whenever you open the "Create Event" form.
              </div>
            </div>

            <div className="bg-slate-900 p-10 rounded-3xl shadow-xl text-white">
              <h3 className="text-xl font-black mb-4 flex items-center gap-2">
                <Users size={24} className="text-blue-400" /> Team Management
              </h3>
              <p className="text-slate-400 text-sm mb-6 font-medium">Manage who has access to your Eventcast PRO dashboard.</p>
              <div className="space-y-4">
                <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center font-black">
                      {user?.email?.charAt(0).toUpperCase() || "A"}
                    </div>
                    <div>
                      <p className="font-bold">{user?.email || "Super Admin"}</p>
                      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Owner / Super Admin</p>
                    </div>
                  </div>
                  <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-[10px] font-black uppercase">Active</span>
                </div>
              </div>
              <button className="mt-6 text-sm font-bold text-blue-400 hover:text-blue-300 flex items-center gap-2">
                <PlusCircle size={16} /> Add New Collaborator (Coming Soon)
              </button>
            </div>
          </div>
        )}
        {activeTab === "photographers" && (
          <PhotographerManagement 
            photographers={photographers} 
            isSubmitting={isSubmitting} 
            addPhotographer={addPhotographer}
            deletePhotographer={deletePhotographer}
            onEdit={handleEditPhotographer}
            isEditing={isEditingPhotographer}
          />
        )}
      </main>

      <AssetPreviewModal selectedAsset={selectedAsset} setSelectedAsset={setSelectedAsset} />
    </div>
  );
}
// Trigger deployment

