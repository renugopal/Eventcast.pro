"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { 
  PlusCircle, List, Settings, BarChart3, Image as ImageIcon, Video, Search, 
  MapPin, Clock, Calendar, UploadCloud, Film, Play, CheckCircle2, AlertCircle,
  AlertTriangle, Loader2, Link as LinkIcon, X, Layout, Users, Menu, ChevronRight,
  Shield, Zap, RefreshCw, Star, Globe, Lock, Eye, EyeOff, Save, Trash2,
  ChevronLeft, ChevronDown, Check, Copy, ExternalLink, Info, Bell, Phone,
  Edit, Plus, Minus, ArrowLeft, ArrowRight, Download, Upload, QrCode
} from "lucide-react";
import { useRouter } from "next/navigation";
import { authFetch, AuthError } from "@/lib/client-auth";

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [wishes, setWishes] = useState<any[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any[]>([]);
  const [assetLibrary, setAssetLibrary] = useState<any[]>([]); // Grouped by event
  const [showHealthCheck, setShowHealthCheck] = useState(false);
  const [healthResults, setHealthResults] = useState<any[]>([]);
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
    notes: "",
    youtube_broadcast_id: "",
    youtube_stream_key: "",
    youtube_url: "",
    slug: "",  // populated when editing; used to organise uploads into the correct Cloudinary folder
  });

  const [hasManuallyEditedInitials, setHasManuallyEditedInitials] = useState(false);
  const [photographerSearchQuery, setPhotographerSearchQuery] = useState("");
  const [selectedPhotographer, setSelectedPhotographer] = useState<any>(null);
  const [showPhotographerList, setShowPhotographerList] = useState(false);
  const [venueSearchQuery, setVenueSearchQuery] = useState("");
  const [isSearchingVenue, setIsSearchingVenue] = useState(false);
  const [mapPreviewUrl, setMapPreviewUrl] = useState(""); // Resolved, working embed URL for preview
  const [isResolvingMap, setIsResolvingMap] = useState(false);
  const [selectedBaseDesign, setSelectedBaseDesign] = useState("ec_premium_pink_v1");
  const [isEditingPhotographer, setIsEditingPhotographer] = useState(false);
  const [editingPhotographerId, setEditingPhotographerId] = useState<string | null>(null);
  const [editingPhotographerData, setEditingPhotographerData] = useState<any | null>(null);

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

    // Real-time listener: increment the affected event's count in-place
    // instead of re-fetching all rows from the DB on every single INSERT.
    const viewsChannel = supabase
      .channel('realtime-views')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'page_views' }, (payload) => {
        const eventId = payload.new?.event_id;
        if (!eventId) return;
        setAnalyticsData(prev => prev.map(e =>
          e.id === eventId ? { ...e, view_count: (e.view_count || 0) + 1 } : e
        ));
        setEvents(prev => prev.map(e =>
          e.id === eventId ? { ...e, view_count: (e.view_count || 0) + 1 } : e
        ));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(viewsChannel);
    };
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
    const { data: viewCountRows } = await supabase.rpc('get_event_view_counts');
    
    if (eventsData) {
      const viewCounts = (viewCountRows || []).reduce((acc: any, row: any) => {
        acc[row.event_id] = row.view_count;
        return acc;
      }, {});

      const eventsWithViews = eventsData.map((e: any) => ({
        ...e,
        view_count: viewCounts[e.id] || 0
      }));

      setEvents(eventsWithViews);
      
      // Group assets by event for Folder View
      const groupedAssets = eventsWithViews.map((e: any) => ({
        eventId: e.id,
        eventTitle: `${e.groom_name || e.celebrant_name} & ${e.bride_name || 'Family'}`,
        slug: e.slug,
        assets: [
          e.thumbnail_url,
          e.invitation_video_url,
          ...(Array.isArray(e.gallery_urls) ? e.gallery_urls : [])
        ].filter(Boolean)
      })).filter(group => group.assets.length > 0);

      setAssetLibrary(groupedAssets);
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
    // Single aggregate query — no raw rows shipped to the client
    const { data: eventsData } = await supabase
      .from('events')
      .select('id, groom_name, celebrant_name, bride_name, event_type, slug, event_date')
      .order('created_at', { ascending: false });

    const { data: viewCountRows } = await supabase.rpc('get_event_view_counts');

    if (eventsData) {
      const countMap = (viewCountRows || []).reduce((acc: any, row: any) => {
        acc[row.event_id] = row.view_count;
        return acc;
      }, {});

      const newAnalytics = eventsData.map((e: any) => ({
        ...e,
        view_count: countMap[e.id] || 0,
      }));
      setAnalyticsData(newAnalytics);

      // Keep EventTable in sync
      setEvents(prev => prev.map(e => ({
        ...e,
        view_count: countMap[e.id] || 0,
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

  // Extract a working embed URL from a resolved Google Maps full URL
  const extractEmbedUrl = (resolvedUrl: string): string => {
    if (!resolvedUrl) return '';
    try {
      // If the user pasted a raw iframe, extract its src directly
      if (resolvedUrl.includes('<iframe')) {
        const match = resolvedUrl.match(/src="([^"]+)"/);
        if (match) return match[1];
      }

      // If it's already an embed URL, use it directly
      if (resolvedUrl.includes('/maps/embed')) return resolvedUrl;
      
      const url = new URL(resolvedUrl);
      let query = '';

      // Highest precision: extract exact coordinates if present
      if (url.pathname.includes('/@')) {
        const coordsMatch = url.pathname.match(/\/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (coordsMatch) {
          query = `${coordsMatch[1]},${coordsMatch[2]}`;
        }
      }

      // Fallback to place name or search term
      if (!query && url.pathname.includes('/place/')) {
        const raw = url.pathname.split('/place/')[1].split('/')[0];
        query = decodeURIComponent(raw.replace(/\+/g, ' ')).split('/@')[0].trim();
      } else if (!query && url.pathname.includes('/search/')) {
        const part = url.pathname.split('/search/')[1];
        if (part && part.length > 0) {
          query = decodeURIComponent(part.split('/')[0].replace(/\+/g, ' ')).trim();
        }
      }
      if (!query) {
        query = url.searchParams.get('q') || url.searchParams.get('query') || '';
      }
      if (!query) return '';

      // Use Google Maps legacy embed format (highly compatible)
      return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
    } catch {
      return '';
    }
  };

  // Resolve any Maps link (including short links) → get a working embed URL
  const resolveMapPreview = async (linkOrQuery: string, isSearchQuery = false) => {
    if (!linkOrQuery.trim()) return;
    setIsResolvingMap(true);
    try {
      // For search queries, build the URL to resolve
      const urlToResolve = isSearchQuery
        ? `https://www.google.com/maps/search/?q=${encodeURIComponent(linkOrQuery.trim())}`
        : linkOrQuery;

      const res = await authFetch('/api/resolve-url', {
        method: 'POST',
        body: JSON.stringify({ url: urlToResolve }),
      });
      const data = await res.json();
      const resolvedUrl = data.resolvedUrl || urlToResolve;
      const embedUrl = extractEmbedUrl(resolvedUrl);
      setMapPreviewUrl(embedUrl);
    } catch {
      // Fallback: try to build an embed URL directly from the input
      const fallback = isSearchQuery
        ? `https://maps.google.com/maps?q=${encodeURIComponent(linkOrQuery.trim())}&t=&z=15&ie=UTF8&iwloc=&output=embed`
        : extractEmbedUrl(linkOrQuery);
      setMapPreviewUrl(fallback);
    } finally {
      setIsResolvingMap(false);
    }
  };

  // Search venue — resolves and updates map preview, never touches venueName
  const handleVenueSearch = async () => {
    if (!venueSearchQuery.trim()) return;
    setIsSearchingVenue(true);
    // Store a simple search link in venueMapLink (used as navigate URL on template)
    const searchLink = `https://www.google.com/maps/search/?q=${encodeURIComponent(venueSearchQuery.trim())}`;
    setFormData(prev => ({ ...prev, venueMapLink: searchLink }));
    await resolveMapPreview(venueSearchQuery.trim(), true);
    setIsSearchingVenue(false);
  };

  // When venueMapLink changes by paste, resolve it for preview (debounced)
  useEffect(() => {
    if (!formData.venueMapLink) { setMapPreviewUrl(''); return; }
    const timer = setTimeout(() => resolveMapPreview(formData.venueMapLink, false), 800);
    return () => clearTimeout(timer);
  }, [formData.venueMapLink]);

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

  // ─── Upload Video → Cloudflare R2 (Zero Egress Fees) ────────────────────────
  async function uploadToR2(files: FileList, folder: string): Promise<string[]> {
    const uploadedUrls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder', folder);
      try {
        const res = await fetch('/api/r2-upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.success && data.url) {
          uploadedUrls.push(data.url);
        } else {
          console.error('R2 upload failed:', data.error);
        }
      } catch (err) {
        console.error('R2 upload error:', err);
      }
    }
    return uploadedUrls;
  }

  // ─── Upload Image → Cloudinary (Eager Transformation, once on upload) ────────
  async function uploadImageToCloudinary(files: FileList, type: string, folder: string): Promise<string[]> {
    const uploadedUrls: string[] = [];
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
    const eager = 'f_auto,q_auto,w_1920,c_limit';

    for (let i = 0; i < files.length; i++) {
      const fileToUpload = await compressImage(files[i]);
      const timestamp = Math.round(Date.now() / 1000).toString();
      const paramsToSign: Record<string, string> = { eager, folder, timestamp };

      let signature = '';
      try {
        const sigRes = await fetch('/api/cloudinary-signature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params: paramsToSign }),
        });
        const sigData = await sigRes.json();
        signature = sigData.signature;
      } catch (err) {
        console.error("Cloudinary signature error:", err);
        continue;
      }

      const formDataUpload = new FormData();
      formDataUpload.append('file', fileToUpload);
      formDataUpload.append('api_key', apiKey || '');
      formDataUpload.append('timestamp', timestamp);
      formDataUpload.append('signature', signature);
      formDataUpload.append('folder', folder);
      formDataUpload.append('eager', eager);

      try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
          method: 'POST',
          body: formDataUpload,
        });
        const data = await res.json();
        if (data.secure_url) {
          // Use pre-transformed eager URL if available, else construct it
          const finalUrl = data.eager?.[0]?.secure_url || data.secure_url.replace('/upload/', `/upload/${eager}/`);
          uploadedUrls.push(finalUrl);
        }
      } catch (err) {
        console.error("Cloudinary upload error:", err);
      }
    }
    return uploadedUrls;
  }

  // ─── Smart Upload Dispatcher ──────────────────────────────────────────────────
  // Videos → Cloudflare R2 (zero bandwidth cost)
  // Images → Cloudinary (eager transforms, once per upload)
  async function uploadToCloudinary(files: FileList | null, type: string) {
    if (!files || files.length === 0) return;
    setIsUploading(type);

    const folder = formData.slug
      ? `events/${formData.slug}`
      : `events/${(formData.groomName || formData.celebrantName || 'temp').toLowerCase().replace(/\s+/g, '-')}`;

    let uploadedUrls: string[] = [];

    if (type === 'video') {
      // ✅ Videos → Cloudflare R2 (no bandwidth charges, no transformation needed)
      uploadedUrls = await uploadToR2(files, folder);
    } else {
      // ✅ Images → Cloudinary (eager transform once, free tier safe)
      uploadedUrls = await uploadImageToCloudinary(files, type, folder);
    }

    // Save results to form state
    if (type === 'thumbnail') setFormData(prev => ({ ...prev, thumbnailUrl: uploadedUrls[0] }));
    else if (type === 'video') {
      const newUrls = uploadedUrls.join('\n');
      setFormData(prev => ({ ...prev, invitationVideoUrls: prev.invitationVideoUrls ? `${prev.invitationVideoUrls}\n${newUrls}` : newUrls }));
    }
    else if (type === 'photographer_logo') setSelectedPhotographer((prev: any) => ({ ...prev, logo_url: uploadedUrls[0] }));
    else if (type === 'loaderPhoto') setFormData(prev => ({ ...prev, loaderPhotoUrl: uploadedUrls[0] }));
    else if (type === 'gallery') {
      const newUrls = uploadedUrls.join('\n');
      setFormData(prev => ({ ...prev, galleryUrls: formData.galleryUrls ? `${formData.galleryUrls}\n${newUrls}` : newUrls }));
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
          const ytRes = await authFetch('/api/youtube', {
            method: 'POST',
            body: JSON.stringify({
              groomName: formData.groomName,
              brideName: formData.brideName,
              celebrantName: formData.celebrantName,
              eventType: formData.eventType,
              eventDate: formData.eventDate,
              targetTime: formData.timerTargetTime || formData.eventTime,
              venueName: formData.venueName,
              thumbnailUrl: finalThumbnailUrl,
              privacy: formData.youtubePrivacy,
            }),
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
        youtube_broadcast_id: youtubeDetails?.broadcastId || formData.youtube_broadcast_id,
        youtube_stream_key: youtubeDetails?.streamKey || formData.youtube_stream_key,
        youtube_url: youtubeDetails?.youtubeUrl || formData.youtube_url
      };

      const res = await authFetch('/api/events/generate', {
        method: 'POST',
        body: JSON.stringify({ ...payload, isEditing, editingId }),
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
      if (err instanceof AuthError) { router.push('/login'); return; }
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
      notes: "",
      slug: "",
      youtube_broadcast_id: "",
      youtube_stream_key: "",
      youtube_url: "",
    });
    setHasManuallyEditedInitials(false);
    setSelectedPhotographer(null);
  };

  const runHealthCheck = () => {
    const issues = [];
    
    // 1. Critical Checks
    if (!formData.groomName && !formData.celebrantName) issues.push({ type: 'error', text: 'Main name (Groom/Celebrant) is missing!' });
    if (!formData.eventDate) issues.push({ type: 'error', text: 'Event date is not set!' });
    if (!formData.thumbnailUrl) issues.push({ type: 'warning', text: 'No thumbnail uploaded. Social sharing will look basic.' });
    if (!formData.venueMapLink) issues.push({ type: 'warning', text: 'Google Maps link is missing. Guests might find it hard to navigate.' });
    
    // 2. Production Quality Checks
    if (!selectedPhotographer) issues.push({ type: 'info', text: 'No photographer credited. Good for branding!' });
    if (!formData.loaderPhotoUrl) issues.push({ type: 'info', text: 'Custom loader photo is not set. Default will be used.' });
    if (!formData.invitationVideoUrls) issues.push({ type: 'info', text: 'No invitation video. Cinematic experience might be less.' });
    
    // 3. YouTube Check
    if (isEditing && !formData.vodLink) issues.push({ type: 'warning', text: 'No VOD/Stream link set. Guests won\'t be able to watch live.' });

    setHealthResults(issues);
    setShowHealthCheck(true);
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
      notes: event.notes || "",
      youtube_broadcast_id: event.youtube_broadcast_id || "",
      youtube_stream_key: event.youtube_stream_key || "",
      youtube_url: event.youtube_url || "",
      slug: event.slug || "",
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
      notes: event.notes || "",
      youtube_broadcast_id: "",
      youtube_stream_key: "",
      youtube_url: "",
      slug: "",
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
      const res = await authFetch('/api/events/delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete event.");
      }
      
      alert("✅ Event and all related data deleted successfully!");
      fetchEvents();
    } catch (err: any) {
      if (err instanceof AuthError) { router.push('/login'); return; }
      console.error("Delete error:", err);
      alert(`❌ Delete failed: ${err.message}`);
    } finally {
      setIsLoadingEvents(false);
    }
  }

  async function deleteMultipleEvents(ids: string[]) {
    setIsLoadingEvents(true);
    // Process in small sequential batches to avoid saturating the GitHub API.
    // Each delete makes ~5 GitHub API calls; firing 10+ simultaneously risks 429s.
    const BATCH_SIZE = 2;
    const results: { success: boolean; error?: string }[] = [];
    try {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(id =>
            authFetch('/api/events/delete', {
              method: 'POST',
              body: JSON.stringify({ id }),
            }).then(res => res.json())
          )
        );
        results.push(...batchResults);
      }

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
      setEditingPhotographerData(null);
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
    // Pass data to the controlled form via state — no DOM manipulation needed
    setEditingPhotographerData(pg);
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

  if (isAuthLoading) return <div className="h-screen flex items-center justify-center bg-[#07070d]"><Loader2 className="animate-spin text-blue-500" size={48} /></div>;

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
    <div className="flex min-h-screen bg-[#030307] font-sans text-white selection:bg-blue-500/30 selection:text-blue-200 md:overflow-hidden relative">
      
      {/* Universal Ambient Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden>
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/[0.03] rounded-full blur-[120px]" />
      </div>

      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        handleSignOut={handleSignOut}
        isMobileOpen={isMobileMenuOpen}
        setIsMobileOpen={setIsMobileMenuOpen}
      />

      <div className="flex-1 flex flex-col h-screen overflow-hidden relative z-10">
        {/* Mobile Header */}
        <header className="md:hidden border-b border-white/[0.08] p-5 flex items-center justify-between sticky top-0 z-30 backdrop-blur-xl bg-white/[0.02]">
          <div className="flex items-center gap-4">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20"
              style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}
            >
              <Layout size={18} />
            </div>
            <div>
              <h1 className="font-black text-white tracking-tighter text-lg leading-none">EVENTCAST</h1>
              <p className="text-[9px] font-black tracking-[0.2em] text-blue-500 uppercase mt-1">ADMIN CONTROL</p>
            </div>
          </div>
          <button 
            className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white bg-white/[0.05] border border-white/[0.08] rounded-2xl transition-all"
            onClick={() => setIsMobileMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
        </header>

        <main className="flex-1 p-6 sm:p-8 md:p-12 overflow-y-auto w-full custom-scrollbar">
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
          <div className="max-w-5xl mx-auto pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {submitStatus && (
              <div className={`mb-10 p-6 rounded-[2rem] flex items-center gap-4 backdrop-blur-xl border ${submitStatus.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/20 shadow-lg shadow-green-500/5' : 'bg-red-500/10 text-red-400 border-red-500/20 shadow-lg shadow-red-500/5'}`}>
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${submitStatus.type === 'success' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                  {submitStatus.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
                </div>
                <div>
                  <p className="text-sm font-black uppercase tracking-widest">{submitStatus.type === 'success' ? 'Protocol Success' : 'System Alert'}</p>
                  <p className="text-xs font-bold opacity-70 mt-0.5">{submitStatus.message}</p>
                </div>
                <button onClick={() => setSubmitStatus(null)} className="ml-auto w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all">
                   <X size={16} />
                </button>
              </div>
            )}

            <div 
              className="rounded-[3rem] border p-8 md:p-12 backdrop-blur-2xl shadow-2xl relative overflow-hidden"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/[0.03] blur-[100px] -z-10" />
              
              <form onSubmit={handleSubmit} className="space-y-16">
                {/* 1. Identity Section */}
                <section>
                  <div className="flex items-center gap-4 mb-10">
                    <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
                      <Calendar size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white tracking-tight">Event Identity</h3>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Event Details</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="md:col-span-1">
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Page Top Title (Two Lines)</label>
                      <textarea
                        name="customTopTitle"
                        value={formData.customTopTitle}
                        onChange={handleInputChange}
                        rows={2}
                        placeholder={formData.templateId === "half-saree-template-01" ? "Grand Celebration" : "Wedding Invitation"}
                        className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base resize-none placeholder:text-white/10"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation();
                          }
                        }}
                      />
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Event Type</label>
                      <div className="relative group">
                        <select 
                          name="eventType" 
                          value={formData.eventType} 
                          onChange={handleInputChange} 
                          className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base appearance-none cursor-pointer group-hover:border-white/20"
                        >
                          <option className="bg-[#0d0d17]">Wedding</option>
                          <option className="bg-[#0d0d17]">Engagement</option>
                          <option className="bg-[#0d0d17]">Reception</option>
                          <option className="bg-[#0d0d17]">Birthday</option>
                          <option className="bg-[#0d0d17]">Half Saree</option>
                          <option className="bg-[#0d0d17]">Dhoti Ceremony</option>
                        </select>
                        <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-white/20 pointer-events-none" size={20} />
                      </div>
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Website Template</label>
                      <div className="relative group">
                        <select 
                          name="templateId" 
                          value={formData.templateId} 
                          onChange={handleInputChange} 
                          className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-sm appearance-none cursor-pointer group-hover:border-white/20"
                        >
                          <option value="wedding-template-01" className="bg-[#0d0d17]">Wedding: Pink & Gold</option>
                          <option value="half-saree-template-01" className="bg-[#0d0d17]">Half Saree: Emerald</option>
                          <option value="dhoti-ceremony-template-01" className="bg-[#0d0d17]">Dhoti: Royal Blue</option>
                          <option value="wedding-template" className="bg-[#0d0d17]">Modern Sage</option>
                          <option value="wedding" className="bg-[#0d0d17]">Traditional Maroon</option>
                        </select>
                        <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-white/20 pointer-events-none" size={20} />
                      </div>
                    </div>
                    {(formData.eventType === "Wedding" || formData.eventType === "Engagement" || formData.eventType === "Reception") ? (
                      <>
                        <div className="md:col-span-1">
                          <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Groom's Name</label>
                          <input type="text" name="groomName" value={formData.groomName} onChange={handleInputChange} required className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10" placeholder="Groom's Name" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Bride's Name</label>
                          <input type="text" name="brideName" value={formData.brideName} onChange={handleInputChange} required className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10" placeholder="Bride's Name" />
                        </div>
                      </>
                    ) : (
                      <div className="md:col-span-3">
                        <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Celebrant Name</label>
                        <input type="text" name="celebrantName" value={formData.celebrantName} onChange={handleInputChange} required className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10" placeholder="Celebrant's Name" />
                      </div>
                    )}
                  </div>
                </section>

                {/* 1.5. Loader & Branding */}
                <section>
                  <div className="flex items-center gap-4 mb-10">
                    <div className="w-12 h-12 bg-purple-500/10 text-purple-400 rounded-2xl flex items-center justify-center border border-purple-500/20 shadow-lg shadow-purple-500/5">
                      <Layout size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white tracking-tight">Branding & Loader</h3>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Loader & Branding</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Custom Initials</label>
                      <input 
                        type="text" 
                        name="customInitials" 
                        value={formData.customInitials} 
                        onChange={handleInputChange} 
                        placeholder="e.g. A & N"
                        className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10 uppercase" 
                      />
                    </div>
                    <div className="flex flex-col justify-center">
                      <div className="flex items-center mb-6">
                        <label className="flex items-center gap-4 cursor-pointer group">
                          <div className="relative">
                            <input 
                              type="checkbox" 
                              name="hideLoaderPhoto" 
                              checked={formData.hideLoaderPhoto} 
                              onChange={handleInputChange} 
                              className="peer sr-only" 
                            />
                            <div className="w-12 h-6 bg-white/10 rounded-full border border-white/10 transition-all peer-checked:bg-blue-600"></div>
                            <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all peer-checked:translate-x-6"></div>
                          </div>
                          <div>
                            <span className="block text-sm font-black text-white group-hover:text-blue-400 transition-colors uppercase tracking-widest">Hide Loader Photo</span>
                            <span className="block text-[10px] font-bold text-white/30 uppercase mt-1">Initials-Only Centric View</span>
                          </div>
                        </label>
                      </div>
                      
                      {!formData.hideLoaderPhoto && (
                        <div className="animate-in fade-in zoom-in-95 duration-500">
                          <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Loader Photo URL</label>
                          <div className="relative group">
                            <input
                              type="text"
                              name="loaderPhotoUrl"
                              value={formData.loaderPhotoUrl}
                              onChange={handleInputChange}
                              placeholder="Leave empty to auto-fetch"
                              className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-sm pr-16 placeholder:text-white/10"
                            />
                            <button
                              type="button"
                              onClick={() => loaderPhotoInputRef.current?.click()}
                              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-blue-500/20 text-blue-400 rounded-xl hover:bg-blue-500 hover:text-white transition-all shadow-lg border border-blue-500/20"
                            >
                              {isUploading === 'loaderPhoto' ? <Loader2 size={18} className="animate-spin" /> : <UploadCloud size={18} />}
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
                            <div className="mt-3 text-[9px] text-green-400 font-black uppercase tracking-widest flex items-center gap-2">
                              <CheckCircle2 size={12} /> Custom photo saved successfully
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* 2. Chronology Section */}
                <section>
                  <div className="flex items-center gap-4 mb-10">
                    <div className="w-12 h-12 bg-pink-500/10 text-pink-400 rounded-2xl flex items-center justify-center border border-pink-500/20 shadow-lg shadow-pink-500/5">
                      <Clock size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white tracking-tight">Date & Time</h3>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Event Schedule</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="md:col-span-1">
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Event Date</label>
                      <input type="date" name="eventDate" value={formData.eventDate} onChange={handleInputChange} required className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base [color-scheme:dark] cursor-pointer" />
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Display Time</label>
                      <input type="text" name="eventTime" value={formData.eventTime} onChange={handleInputChange} placeholder="e.g. 10:30 AM onwards" className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10" />
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Timer Target (24h)</label>
                      <input type="time" name="timerTargetTime" value={formData.timerTargetTime} onChange={handleInputChange} className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base [color-scheme:dark] cursor-pointer" />
                    </div>
                    <div className="md:col-span-1 flex items-center pt-8">
                      <label className="flex items-center gap-4 cursor-pointer group">
                        <div className="relative">
                          <input type="checkbox" name="showTimer" checked={formData.showTimer} onChange={handleInputChange} className="peer sr-only" />
                          <div className="w-12 h-6 bg-white/10 rounded-full border border-white/10 transition-all peer-checked:bg-pink-600"></div>
                          <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all peer-checked:translate-x-6"></div>
                        </div>
                        <span className="text-[11px] font-black text-white uppercase tracking-widest group-hover:text-pink-400 transition-colors">Show Countdown Timer</span>
                      </label>
                    </div>
                  </div>
                </section>

                {/* 3. Navigation Section */}
                <section>
                  <div className="flex items-center gap-4 mb-10">
                    <div className="w-12 h-12 bg-green-500/10 text-green-400 rounded-2xl flex items-center justify-center border border-green-500/20 shadow-lg shadow-green-500/5">
                      <MapPin size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white tracking-tight">Venue & Location</h3>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Venue Details</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    <div className="space-y-8">
                      <div>
                        <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Venue Name (Display)</label>
                        <input
                          type="text"
                          name="venueName"
                          value={formData.venueName}
                          onChange={handleInputChange}
                          placeholder="e.g. Sri Venkateswara Kalyana Mandapam"
                          className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10"
                        />
                        <div className="flex gap-3 mt-6">
                          <input
                            type="text"
                            value={venueSearchQuery}
                            onChange={e => setVenueSearchQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleVenueSearch(); } }}
                            placeholder="Search venue or location..."
                            className="flex-1 p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10"
                          />
                          <button
                            type="button"
                            onClick={handleVenueSearch}
                            disabled={isSearchingVenue || !venueSearchQuery.trim()}
                            className="px-6 bg-blue-600 text-white rounded-2xl font-black text-sm hover:bg-blue-700 transition-all disabled:opacity-30 flex items-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95"
                          >
                            {isSearchingVenue ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                            {isSearchingVenue ? '' : 'Search'}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Google Maps Link</label>
                        <input
                          type="text"
                          name="venueMapLink"
                          value={formData.venueMapLink}
                          onChange={handleInputChange}
                          placeholder="Paste direct maps URL..."
                          className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-sm placeholder:text-white/10"
                        />
                        {formData.venueMapLink && (
                          <div className="mt-3">
                             {extractEmbedUrl(formData.venueMapLink) ? (
                               <p className="text-[9px] text-green-400 font-black uppercase tracking-widest flex items-center gap-2"><CheckCircle2 size={12} /> ✅ Maps link looks valid</p>
                             ) : formData.venueMapLink.includes('goo.gl') ? (
                               <p className="text-[9px] text-amber-400 font-black uppercase tracking-widest flex items-center gap-2 animate-pulse">🔄 Initializing short-link resolution...</p>
                             ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white/[0.02] rounded-[2.5rem] border border-white/[0.08] flex items-center justify-center overflow-hidden h-full min-h-[280px] relative shadow-2xl group">
                      {isResolvingMap ? (
                        <div className="flex flex-col items-center gap-4 text-blue-400">
                          <Loader2 size={32} className="animate-spin" />
                          <span className="text-[10px] font-black uppercase tracking-widest">Loading map...</span>
                        </div>
                      ) : mapPreviewUrl ? (
                        <iframe
                          key={mapPreviewUrl}
                          width="100%"
                          height="100%"
                          className="grayscale contrast-125 opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-700"
                          style={{ border: 0, minHeight: '280px' }}
                          loading="lazy"
                          src={mapPreviewUrl}
                        />
                      ) : (
                        <div className="text-white/10 flex flex-col items-center gap-4 p-8 text-center">
                          <div className="w-16 h-16 rounded-full bg-white/[0.02] border border-white/[0.05] flex items-center justify-center mb-2">
                             <MapPin size={32} />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.4em]">Map preview will appear here</span>
                          <span className="text-[9px] font-bold text-white/5 uppercase tracking-widest">Search or paste a Maps link above</span>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* 4. Media & Cloudinary */}
                <section>
                  <div className="flex items-center gap-4 mb-10">
                    <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
                      <UploadCloud size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white tracking-tight">Media & Assets</h3>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Media Uploads</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div className="space-y-8">
                      <div>
                        <div className="flex justify-between items-center mb-3">
                          <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Event Thumbnail (for SEO)</label>
                          <label className="flex items-center gap-2 cursor-pointer group">
                             <input type="checkbox" id="autoThumb" checked={formData.autoGenerateThumbnail} onChange={(e) => setFormData(prev => ({ ...prev, autoGenerateThumbnail: e.target.checked }))} className="peer sr-only" />
                             <div className="w-8 h-4 bg-white/10 rounded-full border border-white/10 transition-all peer-checked:bg-blue-600 relative">
                               <div className="absolute left-0.5 top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-all peer-checked:translate-x-4"></div>
                             </div>
                             <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest group-hover:text-white transition-colors">Auto-Design AI</span>
                          </label>
                        </div>
                        <div className="relative group">
                          <input
                            type="text"
                            name="thumbnailUrl"
                            value={formData.thumbnailUrl}
                            onChange={handleInputChange}
                            placeholder="Thumbnail URL..."
                            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-2xl px-5 py-5 text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-white/10 pr-16 font-black text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => thumbInputRef.current?.click()}
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center"
                          >
                            <UploadCloud size={18} />
                          </button>
                          <input type="file" ref={thumbInputRef} hidden accept="image/*" onChange={(e) => uploadToCloudinary(e.target.files, 'thumbnail')} />
                        </div>

                        {formData.thumbnailUrl && (
                          <div className="mt-6 space-y-6 animate-in fade-in zoom-in-95 duration-700">
                            <div className="p-2 bg-white/[0.02] border border-white/[0.08] rounded-[2rem] overflow-hidden shadow-2xl group relative">
                              <img src={formData.thumbnailUrl} alt="Thumbnail Preview" className="w-full h-48 object-cover rounded-[1.75rem] group-hover:scale-110 transition-transform duration-700 opacity-80 group-hover:opacity-100" />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                            </div>

                            {/* ✨ Names on Photo Designer */}
                            {formData.thumbnailUrl.includes('cloudinary.com') && (formData.groomName || formData.celebrantName) && (
                              <div className="p-8 bg-blue-500/5 border border-blue-500/20 rounded-[2.5rem] space-y-6 shadow-2xl relative overflow-hidden backdrop-blur-md">
                                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Zap size={80} /></div>
                                <h4 className="text-xs font-black text-blue-400 uppercase tracking-[0.2em] flex items-center gap-3">
                                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shadow-[0_0_8px_rgba(96,165,250,1)]" />
                                  Add Names to Thumbnail
                                </h4>
                                <div className="grid grid-cols-2 gap-3">
                                  {[
                                    ['classic_white','☁️ Classic'], 
                                    ['golden','✨ Golden'], 
                                    ['dark_shadow','🖤 Stealth'], 
                                    ['minimal','🤍 Minimal']
                                  ].map(([val, label]) => (
                                    <button key={val} type="button"
                                      onClick={() => setThumbOverlayStyle(val as any)}
                                      className={`py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] border transition-all ${
                                        thumbOverlayStyle === val
                                          ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-600/30'
                                          : 'bg-white/[0.03] text-white/40 border-white/[0.08] hover:border-blue-500/40 hover:text-white'
                                      }`}
                                    >{label}</button>
                                  ))}
                                </div>
                                <button type="button" onClick={generateThumbWithNames}
                                  className="w-full py-4 bg-white/10 hover:bg-white text-white hover:text-black rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 border border-white/10"
                                >
                                  <Zap size={16} /> Preview with Names
                                </button>
                                
                                {thumbOverlayPreview && (
                                  <div className="space-y-4 animate-in fade-in zoom-in-95 duration-500">
                                    <div className="relative rounded-[1.5rem] overflow-hidden border-2 border-blue-500/30 shadow-2xl">
                                       <img src={thumbOverlayPreview} alt="Synthesis Preview" className="w-full" />
                                       <div className="absolute top-3 right-3 px-3 py-1 bg-blue-600 text-white text-[8px] font-black uppercase rounded-full">PREVIEW</div>
                                    </div>
                                    <button type="button"
                                      onClick={() => { setFormData(prev => ({ ...prev, thumbnailUrl: thumbOverlayPreview })); setThumbOverlayPreview(''); }}
                                      className="w-full py-4 bg-green-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-green-500 transition-all shadow-lg shadow-green-600/20"
                                    >
                                      ✅ Use This Thumbnail
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-8">
                        <div>
                          <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">
                            Invitation Video (MP4)
                          </label>
                          <textarea
                            name="invitationVideoUrls"
                            value={formData.invitationVideoUrls}
                            onChange={handleInputChange}
                            rows={2}
                            className="w-full p-5 bg-white/[0.02] border border-white/[0.08] rounded-2xl font-mono text-[10px] mb-4 text-white/20 outline-none focus:ring-0 transition-all cursor-default resize-none"
                            placeholder="Video URLs will appear here..."
                            readOnly
                          />
                          <button
                            type="button"
                            onClick={() => videoInputRef.current?.click()}
                            className="w-full flex items-center justify-center gap-3 py-5 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-500 font-black uppercase tracking-[0.2em] text-xs transition-all shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
                          >
                            {isUploading === 'video' ? <Loader2 className="animate-spin" size={18} /> : <Film size={18} />}
                            {isUploading === 'video' ? 'Uploading...' : 'Upload Video'}
                          </button>
                          <input type="file" ref={videoInputRef} hidden multiple accept="video/*" onChange={(e) => uploadToCloudinary(e.target.files, 'video')} />
                          
                          {formData.invitationVideoUrls && (
                            <div className="mt-6 grid grid-cols-3 gap-3 animate-in fade-in duration-700">
                              {formData.invitationVideoUrls.split('\n').filter(u => u.trim()).map((url, idx) => (
                                <div key={idx} className="relative group rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.02] shadow-xl aspect-square">
                                  <video src={url.trim()} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity duration-500" muted playsInline />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent pointer-events-none flex items-end p-3">
                                    <span className="text-white font-black text-[8px] uppercase tracking-widest">STREAM {idx + 1}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const urls = formData.invitationVideoUrls.split('\n').filter(u => u.trim());
                                      urls.splice(idx, 1);
                                      setFormData(prev => ({ ...prev, invitationVideoUrls: urls.join('\n') }));
                                    }}
                                    className="absolute top-2 right-2 w-7 h-7 bg-red-600 text-white rounded-xl text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110 shadow-lg"
                                  >✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Gallery Upload */}
                    <div className="md:col-span-2 space-y-6">
                      <div className="flex items-center justify-between">
                        <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Photo Gallery</label>
                        {formData.galleryUrls && (
                          <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                            {formData.galleryUrls.split('\n').filter(u => u.trim()).length} Photos
                          </span>
                        )}
                      </div>
                      <textarea name="galleryUrls" value={formData.galleryUrls} onChange={handleInputChange} rows={3} className="w-full p-5 bg-white/[0.02] border border-white/[0.08] rounded-2xl font-mono text-[10px] text-white/20 outline-none focus:ring-0 transition-all resize-none" placeholder="Photo URLs will appear here..." />
                      <button type="button" onClick={() => galleryInputRef.current?.click()} className="w-full flex items-center justify-center gap-3 py-6 bg-white/[0.05] hover:bg-white text-white hover:text-black rounded-[2rem] font-black uppercase tracking-[0.3em] text-sm transition-all border border-white/[0.08] shadow-2xl active:scale-[0.99] group">
                        {isUploading === 'gallery' ? <Loader2 className="animate-spin" size={20} /> : <ImageIcon size={20} className="group-hover:scale-110 transition-transform" />}
                        {isUploading === 'gallery' ? 'Uploading...' : 'Upload Photos'}
                      </button>
                      <input type="file" ref={galleryInputRef} hidden multiple accept="image/*" onChange={(e) => uploadToCloudinary(e.target.files, 'gallery')} />
                      
                      {formData.galleryUrls && (
                        <div className="mt-8 grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3 p-6 bg-white/[0.01] border border-white/[0.05] rounded-[2.5rem] animate-in fade-in duration-1000">
                          {formData.galleryUrls.split('\n').filter(url => url.trim()).map((url, idx) => (
                            <div key={idx} className="relative group aspect-square rounded-xl overflow-hidden border border-white/[0.1] bg-white/[0.05] shadow-lg">
                               <img src={url.trim()} alt={`Asset ${idx + 1}`} className="w-full h-full object-cover opacity-50 group-hover:opacity-100 transition-all duration-500 group-hover:scale-110" />
                               <div className="absolute inset-0 bg-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* 5. Logistics Section */}
                <section>
                  <div className="flex items-center gap-4 mb-10">
                    <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-2xl flex items-center justify-center border border-amber-500/20 shadow-lg shadow-amber-500/5">
                      <Shield size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white tracking-tight">Privacy & YouTube Settings</h3>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Who can see this event</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div>
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-4">Website Privacy</label>
                      <div className="flex flex-col gap-3">
                        {['Public (Visible Everywhere)', 'Unlisted (Link Only)', 'Private (Admin Only)'].map((status) => (
                          <button 
                            key={status} 
                            type="button" 
                            onClick={() => setFormData(prev => ({ ...prev, privacyStatus: status }))} 
                            className={`p-5 rounded-2xl border-2 font-black uppercase tracking-widest text-[11px] transition-all text-left flex items-center justify-between group ${formData.privacyStatus === status ? 'border-blue-500 bg-blue-500/10 text-white shadow-lg shadow-blue-500/10' : 'border-white/[0.08] bg-white/[0.02] text-white/20 hover:border-white/20 hover:text-white/60'}`}
                          >
                            {status}
                            <div className={`w-2 h-2 rounded-full transition-all ${formData.privacyStatus === status ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,1)] scale-125' : 'bg-white/10'}`} />
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="space-y-8">
                      <div>
                        <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">YouTube Privacy</label>
                        <div className="flex gap-4">
                          {['public', 'unlisted'].map((p) => (
                            <button key={p} type="button" onClick={() => setFormData(prev => ({ ...prev, youtubePrivacy: p }))} className={`flex-1 p-5 rounded-2xl border-2 font-black uppercase tracking-[0.2em] text-[11px] transition-all ${formData.youtubePrivacy === p ? 'border-red-500 bg-red-500/10 text-white shadow-lg shadow-red-500/10' : 'border-white/[0.08] bg-white/[0.02] text-white/20 hover:border-white/20 hover:text-white/60'}`}>
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Assign Photographer</label>
                        <div className="relative group">
                          <input
                            type="text"
                            placeholder="Search by name, studio or phone..."
                            value={selectedPhotographer ? (selectedPhotographer.nickname || selectedPhotographer.name) : photographerSearchQuery}
                            onChange={(e) => { setPhotographerSearchQuery(e.target.value); setSelectedPhotographer(null); setShowPhotographerList(true); }}
                            onFocus={() => setShowPhotographerList(true)}
                            className="w-full p-5 pl-14 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10"
                          />
                          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20" size={20} />
                          {selectedPhotographer && (
                            <button type="button" onClick={() => { setSelectedPhotographer(null); setPhotographerSearchQuery(''); }} className="absolute right-5 top-1/2 -translate-y-1/2 text-white/20 hover:text-red-500 transition-colors">
                              <X size={18} />
                            </button>
                          )}
                          
                          {showPhotographerList && photographerSearchQuery && !selectedPhotographer && (
                            <div className="absolute z-50 w-full mt-3 bg-[#11111a] border border-white/10 rounded-[2rem] shadow-2xl max-h-72 overflow-y-auto backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-300 custom-scrollbar">
                              {filteredPhotographers.length === 0 ? (
                                <div className="p-8 text-center text-white/20 text-[10px] font-black uppercase tracking-widest">No photographers found</div>
                              ) : filteredPhotographers.map(p => (
                                <button key={p.id} type="button" onClick={() => { setSelectedPhotographer(p); setShowPhotographerList(false); }} className="w-full p-5 hover:bg-white/[0.05] text-left border-b border-white/[0.03] transition-all group">
                                  <div className="flex items-center gap-5">
                                    <div className="w-12 h-12 rounded-2xl overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center p-1 group-hover:scale-105 transition-transform">
                                      {p.logo_url ? (
                                        <img src={p.logo_url} className="w-full h-full object-contain" alt="" />
                                      ) : (
                                        <div className="text-blue-400 font-black text-lg">{(p.nickname || p.name || '?')[0].toUpperCase()}</div>
                                      )}
                                    </div>
                                    <div>
                                      <p className="text-sm font-black text-white group-hover:text-blue-400 transition-colors tracking-tight">{p.name || 'Unknown Studio'}</p>
                                      <p className="text-[10px] text-white/20 font-bold uppercase tracking-widest mt-1">{p.city || 'Remote'}</p>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {selectedPhotographer && (
                          <div className="mt-4 p-4 bg-blue-500/5 rounded-2xl border border-blue-500/20 flex items-center justify-between animate-in slide-in-from-top-2 duration-500">
                            <div className="flex items-center gap-4">
                               <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 font-black">
                                 {selectedPhotographer.logo_url ? <img src={selectedPhotographer.logo_url} className="w-full h-full object-contain p-1" /> : (selectedPhotographer.nickname || selectedPhotographer.name)[0]}
                               </div>
                               <div>
                                 <p className="text-xs font-black text-white uppercase tracking-widest">{selectedPhotographer.name}</p>
                                 <p className="text-[9px] text-blue-400 font-black uppercase tracking-widest mt-0.5">{selectedPhotographer.phone_number || 'No Phone'}</p>
                               </div>
                            </div>
                            <span className="px-3 py-1 bg-blue-500 text-white text-[8px] font-black uppercase rounded-full shadow-lg shadow-blue-500/20">CREDITED</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* 6. Internal Metadata */}
                <section>
                  <div className="flex items-center gap-4 mb-10">
                    <div className="w-12 h-12 bg-white/10 text-white rounded-2xl flex items-center justify-center border border-white/20 shadow-lg">
                      <Layout size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white tracking-tight">Internal Notes</h3>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Private notes (not visible to guests)</p>
                    </div>
                  </div>
                  <div className="relative group">
                    <textarea 
                      placeholder="Add private notes — payment status, client details, etc."
                      value={formData.notes}
                      onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                      className="w-full p-6 bg-white/[0.03] border border-white/[0.08] rounded-[2rem] outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-bold text-white text-base h-40 resize-none placeholder:text-white/10 custom-scrollbar"
                    />
                    <div className="absolute bottom-6 right-6 text-[9px] font-black text-white/10 uppercase tracking-widest pointer-events-none">PRIVATE — NOT VISIBLE TO GUESTS</div>
                  </div>
                </section>

                {/* SEO & Social Preview Section */}
                <section className="bg-blue-600/[0.03] rounded-[3rem] p-10 border border-white/[0.05] relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-32 h-32 bg-blue-600/10 blur-[80px] -z-10" />
                  <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.4em] mb-10 flex items-center gap-4">
                    <Search size={18} className="text-blue-500" /> WhatsApp & Social Media Preview
                  </h3>
                  
                  <div className="max-w-[400px] mx-auto bg-[#1a1a24] rounded-[2.5rem] shadow-2xl border border-white/[0.08] overflow-hidden group">
                    <div className="aspect-video bg-white/[0.02] relative overflow-hidden border-b border-white/[0.08]">
                      {formData.thumbnailUrl ? (
                        <img src={formData.thumbnailUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000" alt="Preview" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-white/10 gap-4">
                          <ImageIcon size={48} strokeWidth={1} className="animate-pulse" />
                          <span className="text-[10px] font-black uppercase tracking-[0.3em]">No thumbnail yet</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
                    </div>
                    <div className="p-8 bg-white/[0.01]">
                      <h4 className="text-base font-black text-white truncate leading-tight tracking-tight">
                        ✨ {formData.groomName || formData.celebrantName || "TARGET"} {formData.eventType} Live
                      </h4>
                      <p className="text-[11px] text-white/40 font-medium line-clamp-2 mt-3 leading-relaxed">
                        Join us live to celebrate this beautiful traditional occasion filled with blessings, happiness, culture, and family moments.
                      </p>
                      <div className="mt-6 pt-6 border-t border-white/[0.05] flex items-center justify-between">
                         <div className="text-[9px] text-blue-500 font-black uppercase tracking-widest">eventcast.pro</div>
                         <div className="text-[9px] text-white/20 font-black uppercase tracking-widest">{formatDisplayDate(formData.eventDate)}</div>
                      </div>
                    </div>
                  </div>
                  <p className="text-[9px] text-white/10 text-center mt-10 font-black tracking-[0.3em] uppercase">
                    * Visual representation of link distribution metadata *
                  </p>
                </section>

                 <div className="pt-16 flex flex-col gap-6">
                  <div className="flex gap-6">
                    <button type="button" onClick={runHealthCheck} className="flex-1 py-6 bg-white/[0.03] text-white hover:bg-white/[0.06] rounded-[2rem] font-black uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-3 border border-white/[0.08] active:scale-95 text-xs shadow-xl">
                      <Search size={20} /> Pre-flight Check
                    </button>
                    <button type="submit" disabled={isSubmitting || !!isUploading} className="flex-[2] py-6 bg-blue-600 text-white rounded-[2rem] font-black uppercase tracking-[0.4em] text-sm shadow-[0_20px_50px_-10px_rgba(59,130,246,0.5)] hover:bg-blue-500 transition-all disabled:opacity-30 transform active:scale-[0.98] flex items-center justify-center gap-4 group">
                      {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} className="group-hover:rotate-12 transition-transform" />}
                      {isSubmitting ? (isEditing ? "Saving..." : "Creating...") : (isEditing ? "Save Changes" : "Create Event")}
                    </button>
                  </div>
                  {isEditing && (
                    <button type="button" onClick={resetForm} className="w-full py-4 text-white/20 font-black uppercase tracking-[0.4em] hover:text-red-500 transition-all text-[10px] bg-red-500/5 rounded-2xl border border-red-500/0 hover:border-red-500/20">
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
          <div className="max-w-4xl mx-auto space-y-12 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div 
              className="p-8 md:p-12 rounded-[3rem] border backdrop-blur-2xl shadow-2xl relative overflow-hidden"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/[0.03] blur-[100px] -z-10" />
              <h2 className="text-2xl font-black text-white mb-10 flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
                  <Shield size={24} />
                </div>
                <div>
                  <span className="block text-xl tracking-tight">Account Security</span>
                  <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Change your password</span>
                </div>
              </h2>

              <div className="mb-10 p-6 bg-blue-500/5 rounded-2xl border border-blue-500/10 text-blue-400 text-[11px] font-black uppercase tracking-widest leading-relaxed flex items-start gap-4">
                <Zap size={18} className="flex-shrink-0 mt-0.5" />
                <p>Security Notice: Modifying your password will automatically log you out of all other active sessions across devices.</p>
              </div>

              <form onSubmit={handlePasswordUpdate} className="space-y-8">
                <div className="grid grid-cols-1 gap-8">
                  <div>
                    <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Current Password</label>
                    <input type="password" name="currentPassword" required placeholder="Enter current password" className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">New Password (min 8 characters)</label>
                      <input type="password" name="newPassword" required minLength={8} placeholder="Enter new password" className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Confirm New Password</label>
                      <input type="password" name="confirmPassword" required placeholder="Re-enter new password" className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10" />
                    </div>
                  </div>
                </div>
                <button type="submit" disabled={isSubmitting} className="w-full py-5 bg-blue-600 text-white rounded-[2rem] font-black uppercase tracking-[0.4em] text-sm shadow-[0_20px_50px_-10px_rgba(59,130,246,0.5)] hover:bg-blue-500 transition-all disabled:opacity-30 transform active:scale-[0.98] flex items-center justify-center gap-4 group mt-4">
                  {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Shield size={20} className="group-hover:rotate-12 transition-transform" />}
                  {isSubmitting ? "Updating..." : "Update Password"}
                </button>
              </form>
            </div>

            <div 
              className="p-8 md:p-12 rounded-[3rem] border backdrop-blur-2xl shadow-2xl relative overflow-hidden"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
            >
              <div className="absolute top-0 left-0 w-64 h-64 bg-purple-600/[0.03] blur-[100px] -z-10" />
              <h3 className="text-xl font-black text-white mb-10 flex items-center gap-4">
                <div className="w-12 h-12 bg-purple-500/10 text-purple-400 rounded-2xl flex items-center justify-center border border-purple-500/20 shadow-lg shadow-purple-500/5">
                  <Layout size={24} />
                </div>
                <div>
                  <span className="block text-xl tracking-tight">Default Settings</span>
                  <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Preferences saved in your browser</span>
                </div>
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div>
                  <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Default Template</label>
                  <div className="relative group">
                    <select 
                      id="defaultTemplate"
                      className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-sm appearance-none cursor-pointer group-hover:border-white/20"
                      defaultValue={typeof window !== 'undefined' ? localStorage.getItem('defaultTemplate') || 'wedding-template-01' : 'wedding-template-01'}
                      onChange={(e) => localStorage.setItem('defaultTemplate', e.target.value)}
                    >
                      <option value="wedding-template-01" className="bg-[#0d0d17]">Wedding: Pink & Gold</option>
                      <option value="half-saree-template-01" className="bg-[#0d0d17]">Half Saree: Emerald</option>
                      <option value="dhoti-ceremony-template-01" className="bg-[#0d0d17]">Dhoti: Royal Blue</option>
                    </select>
                    <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-white/20 pointer-events-none" size={20} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Default YouTube Privacy</label>
                  <div className="relative group">
                    <select 
                      id="defaultYoutubePrivacy"
                      className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-sm appearance-none cursor-pointer group-hover:border-white/20"
                      defaultValue={typeof window !== 'undefined' ? localStorage.getItem('defaultYoutubePrivacy') || 'public' : 'public'}
                      onChange={(e) => localStorage.setItem('defaultYoutubePrivacy', e.target.value)}
                    >
                      <option value="public" className="bg-[#0d0d17]">Public (Everyone)</option>
                      <option value="unlisted" className="bg-[#0d0d17]">Unlisted (Link Only)</option>
                    </select>
                    <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-white/20 pointer-events-none" size={20} />
                  </div>
                </div>
              </div>
              <div className="mt-10 p-6 bg-white/[0.02] rounded-2xl border border-white/[0.05] text-white/40 text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-4">
                <CheckCircle2 size={16} className="text-green-500" /> Preferences synchronized with local cache storage
              </div>
            </div>

            <div 
              className="p-8 md:p-12 rounded-[3rem] border backdrop-blur-2xl shadow-2xl relative overflow-hidden"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
            >
              <div className="absolute bottom-0 right-0 w-64 h-64 bg-green-600/[0.03] blur-[100px] -z-10" />
              <h3 className="text-xl font-black text-white mb-10 flex items-center gap-4">
                <div className="w-12 h-12 bg-green-500/10 text-green-400 rounded-2xl flex items-center justify-center border border-green-500/20 shadow-lg shadow-green-500/5">
                  <Users size={24} />
                </div>
                <div>
                  <span className="block text-xl tracking-tight">Team Members</span>
                  <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Manage access</span>
                </div>
              </h3>
              
              <div className="space-y-4">
                <div className="p-6 bg-white/[0.03] rounded-3xl border border-white/[0.08] flex items-center justify-between group hover:bg-white/[0.05] transition-all">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center font-black text-xl shadow-lg shadow-blue-600/20 group-hover:scale-105 transition-transform">
                      {user?.email?.charAt(0).toUpperCase() || "A"}
                    </div>
                    <div>
                      <p className="font-black text-white tracking-tight">{user?.email || "Super Admin"}</p>
                      <p className="text-[10px] text-blue-500 font-black uppercase tracking-widest mt-1">Owner</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,1)]" />
                    <span className="text-[10px] font-black text-green-400 uppercase tracking-[0.2em]">Active</span>
                  </div>
                </div>
              </div>
              <button className="mt-10 px-6 py-4 bg-white/5 hover:bg-white/10 text-white/40 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-3 border border-white/5 transition-all">
                <PlusCircle size={18} /> Add Team Member (Coming Soon)
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
            editingPhotographer={editingPhotographerData}
          />
        )}
        </main>
      </div>

      <AssetPreviewModal selectedAsset={selectedAsset} setSelectedAsset={setSelectedAsset} />

      {/* Health Check Modal */}
      {showHealthCheck && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-500">
          <div 
            className="w-full max-w-lg rounded-[3rem] border shadow-2xl overflow-hidden relative animate-in zoom-in-95 duration-500"
            style={{ background: "rgba(13,13,23,0.95)", borderColor: "rgba(255,255,255,0.08)" }}
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />
            
            <div className="p-10 border-b border-white/[0.08] flex items-center justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 blur-[60px] -z-10" />
              <div>
                <h3 className="text-2xl font-black text-white tracking-tight">Mission Readiness</h3>
                <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.4em] mt-1.5">System Health Scan Report</p>
              </div>
              <button onClick={() => setShowHealthCheck(false)} className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-red-500 text-white/40 hover:text-white rounded-2xl transition-all border border-white/5">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-10 space-y-5 max-h-[450px] overflow-y-auto custom-scrollbar">
              {healthResults.length === 0 ? (
                <div className="text-center py-16 animate-in zoom-in-90 duration-700">
                  <div className="w-24 h-24 bg-green-500/10 text-green-400 rounded-full flex items-center justify-center mx-auto mb-8 border border-green-500/20 shadow-[0_0_50px_-10px_rgba(34,197,94,0.3)]">
                    <CheckCircle2 size={48} className="animate-pulse" />
                  </div>
                  <h4 className="text-2xl font-black text-white tracking-tight">All Systems Optimal</h4>
                  <p className="text-white/30 text-[11px] font-black uppercase tracking-[0.2em] mt-3">Ready for High-Priority Deployment</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {healthResults.map((issue, idx) => (
                    <div key={idx} className={`p-6 rounded-3xl flex items-start gap-5 border transition-all animate-in slide-in-from-bottom-2 duration-500 ${
                      issue.type === 'error' ? 'bg-red-500/5 border-red-500/20 text-red-400' : 
                      issue.type === 'warning' ? 'bg-amber-500/5 border-amber-500/20 text-amber-400' : 
                      'bg-blue-500/5 border-blue-500/20 text-blue-400'
                    }`} style={{ animationDelay: `${idx * 100}ms` }}>
                      <div className={`mt-1 w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        issue.type === 'error' ? 'bg-red-500/10' : 
                        issue.type === 'warning' ? 'bg-amber-500/10' : 
                        'bg-blue-500/10'
                      }`}>
                        {issue.type === 'error' ? <AlertCircle size={22} /> : 
                         issue.type === 'warning' ? <AlertTriangle size={22} /> : 
                         <CheckCircle2 size={22} />}
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40 mb-1">{issue.type}</p>
                        <p className="text-sm font-black tracking-tight leading-relaxed">{issue.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="p-10 border-t border-white/[0.08] bg-white/[0.01]">
              <button 
                onClick={() => setShowHealthCheck(false)} 
                className="w-full py-5 bg-white text-black hover:bg-blue-500 hover:text-white rounded-3xl font-black uppercase tracking-[0.4em] text-sm transition-all shadow-xl active:scale-95"
              >
                ACKNOWLEDGEMENT COMPLETE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// Trigger deployment

