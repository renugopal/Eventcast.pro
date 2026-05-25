"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { 
  PlusCircle, List, Settings, BarChart3, Image as ImageIcon, Video, Search, 
  MapPin, Clock, Calendar, UploadCloud, Film, Play, CheckCircle2, AlertCircle,
  AlertTriangle, Loader2, Link as LinkIcon, X, Layout, Users, Menu, ChevronRight,
  Shield, Zap, RefreshCw, Star, Globe, Lock, Eye, EyeOff, Save, Trash2,
  ChevronLeft, ChevronDown, Check, Copy, ExternalLink, Info, Bell, Phone,
  Edit, Plus, Minus, ArrowLeft, ArrowRight, Download, Upload, QrCode, Sparkles
} from "lucide-react";
import { useRouter } from "next/navigation";
import { authFetch, AuthError } from "@/lib/client-auth";

// Sub-components
import { Sidebar } from "./components/Sidebar";
import { EventTable } from "./components/EventTable";
import { WishesModeration } from "./components/WishesModeration";
import GuestPhotoModeration from "./components/GuestPhotoModeration";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { AssetLibrary } from "./components/AssetLibrary";
import { PhotographerManagement } from "./components/PhotographerManagement";
import { AssetPreviewModal } from "./components/AssetPreviewModal";
import { DashboardHome } from "./components/DashboardHome";
import { LiveMonitor } from "./components/LiveMonitor";
import { UserSettings } from "./components/UserSettings";
import { Wallet } from "./components/Wallet";
import { CreateEventFlow } from "./components/CreateEventFlow";
import { useToast, AlertDialog } from "./components/Toast";

export default function AdminDashboard() {
  const router = useRouter();
  const { success, error: toastError, warning } = useToast();
  const [deletePhotographerPending, setDeletePhotographerPending] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("home"); const [user, setUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [studioId, setStudioId] = useState<string | null>(null);
  const [studioSlug, setStudioSlug] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [userPlan, setUserPlan] = useState<string>('free');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [wishes, setWishes] = useState<any[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any[]>([]);
  const [assetLibrary, setAssetLibrary] = useState<any[]>([]); // Grouped by event
  const [showArchived, setShowArchived] = useState(false);
  const [showHealthCheck, setShowHealthCheck] = useState(false);
  const [healthResults, setHealthResults] = useState<any[]>([]);
  const [photographers, setPhotographers] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isLoadingWishes, setIsLoadingWishes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    invitationVideoUrls: "",
    thumbnailUrl: "",
    privacyStatus: "Unlisted (Link Only)",
    galleryUrls: "",
    vodLink: "",
    templateId: (typeof window !== 'undefined' ? localStorage.getItem('defaultTemplate') : null) || "wedding-template-01",
    youtubePrivacy: (typeof window !== 'undefined' ? localStorage.getItem('defaultYoutubePrivacy') : null) || "public",
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
  const [isEditingPhotographer, setIsEditingPhotographer] = useState(false);
  const [editingPhotographerId, setEditingPhotographerId] = useState<string | null>(null);
  const [editingPhotographerData, setEditingPhotographerData] = useState<any | null>(null);

  const thumbInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const photographerLogoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const loaderPhotoInputRef = useRef<HTMLInputElement>(null);

  const [isUploading, setIsUploading] = useState<string | null>(null);

  useEffect(() => {
    checkUser();

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
      setUser(session.user);
      
      // Fetch the user's studio
      const { data: memberData, error: memberError } = await supabase
        .from('studio_members')
        .select('studio_id, studios(slug, display_name)')
        .eq('user_id', session.user.id)
        .limit(1)
        .single();
        
      if (memberData && !memberError) {
        const sid = memberData.studio_id;
        const slug = (memberData.studios as any)?.slug || null;
        setStudioId(sid);
        setStudioSlug(slug);

        // Fetch platform role from platform_users table
        const { data: platformUser } = await supabase
          .from('platform_users')
          .select('platform_role')
          .eq('user_id', session.user.id)
          .limit(1)
          .single();

        // Fallback: studioSlug === 'eventcast' → super_admin (backward compat)
        const role = platformUser?.platform_role ?? (slug === 'eventcast' ? 'super_admin' : 'live_streamer');
        setIsSuperAdmin(role === 'super_admin');

        // Fetch current subscription plan
        const { data: subData } = await supabase
          .from('subscriptions')
          .select('plan_tier')
          .eq('studio_id', sid)
          .limit(1)
          .single();
        setUserPlan(subData?.plan_tier ?? 'free');

        setIsAuthLoading(false);
        
        // Scope all data fetches to this specific studio!
        fetchEvents(sid);
        fetchWishes(sid);
        fetchAnalytics(sid);
        fetchPhotographers(sid);
      } else {
        // Forbidden if no studio association is found
        console.error("No studio found for this user context.");
        await supabase.auth.signOut();
        router.push("/login");
      }
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function fetchEvents(currentStudioId?: string) {
    const targetStudioId = currentStudioId || studioId;
    if (!targetStudioId) return;

    setIsLoadingEvents(true);
    const { data: eventsData, error } = await supabase
      .from('events')
      .select('*, photographers(name)')
      .eq('studio_id', targetStudioId)
      .order('created_at', { ascending: false });
      
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

  async function fetchWishes(currentStudioId?: string) {
    const targetStudioId = currentStudioId || studioId;
    if (!targetStudioId) return;

    setIsLoadingWishes(true);
    const { data } = await supabase
      .from('wishes')
      .select('*, events(groom_name, celebrant_name)')
      .eq('studio_id', targetStudioId)
      .order('created_at', { ascending: false });
    if (data) setWishes(data);
    setIsLoadingWishes(false);
  }

  async function deleteWish(id: string) {
    try {
      const { error } = await supabase
        .from('wishes')
        .delete()
        .eq('id', id);
      if (error) throw error;
      fetchWishes();
    } catch (err: any) {
      console.error("Error deleting wish:", err);
      toastError('Delete failed', err.message);
    }
  }


  async function fetchAnalytics(currentStudioId?: string) {
    const targetStudioId = currentStudioId || studioId;
    if (!targetStudioId) return;

    // Single aggregate query — no raw rows shipped to the client
    const { data: eventsData } = await supabase
      .from('events')
      .select('id, groom_name, celebrant_name, bride_name, event_type, slug, event_date')
      .eq('studio_id', targetStudioId)
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

  async function fetchPhotographers(currentStudioId?: string) {
    const targetStudioId = currentStudioId || studioId;
    if (!targetStudioId) return;

    const { data } = await supabase
      .from('photographers')
      .select('*')
      .eq('studio_id', targetStudioId)
      .order('name');
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
      const finalThumbnailUrl = formData.thumbnailUrl;


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
    setActiveTab("create");
  };

  async function fullDeleteEvent(id: string, permanent: boolean = false) {
    setIsLoadingEvents(true);
    try {
      const res = await authFetch('/api/events/delete', {
        method: 'POST',
        body: JSON.stringify({ id, permanent }),
      });
      
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete event.");
      }
      
      success(permanent ? 'Event deleted' : 'Event archived', permanent ? 'Event and all related data removed permanently.' : 'Moved to archived events.');
      fetchEvents();
    } catch (err: any) {
      if (err instanceof AuthError) { router.push('/login'); return; }
      console.error("Delete error:", err);
      toastError('Delete failed', err.message);
    } finally {
      setIsLoadingEvents(false);
    }
  }

  async function restoreEvent(id: string) {
    setIsLoadingEvents(true);
    try {
      const res = await authFetch('/api/events/restore', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      success('Event Restored', 'Event has been moved back to active.');
      fetchEvents();
    } catch (err: any) {
      toastError('Restore failed', err.message);
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
        warning('Partial delete', `${failed.length} events failed. ${results.length - failed.length} deleted successfully.`);
      } else {
        success('All deleted', `${ids.length} events removed successfully.`);
      }
      fetchEvents();
    } catch (err) {
      console.error("Bulk delete error:", err);
      toastError('Bulk delete failed', 'An error occurred. Some events may not have been deleted.');
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
        success('Photographer updated', 'Studio credit updated successfully.');
      } else {
        const { error } = await supabase.from('photographers').insert(photographerData);
        if (error) throw error;
        success('Photographer added', 'New studio credit saved successfully.');
      }
      
      e.target.reset();
      setIsEditingPhotographer(false);
      setEditingPhotographerId(null);
      setEditingPhotographerData(null);
      fetchPhotographers();
    } catch (error: any) {
      console.error("Photographer Action Error:", error);
      toastError('Action failed', error.message);
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
    setDeletePhotographerPending(id);
  }

  async function confirmDeletePhotographer(id: string) {
    try {
      const { error } = await supabase.from('photographers').delete().eq('id', id);
      if (error) throw error;
      success('Photographer deleted', 'Studio credit removed successfully.');
      fetchPhotographers();
    } catch (err: any) {
      toastError('Delete failed', err.message);
    }
  }

  function getVideoThumbnail(url: string) {
    if (url.includes('cloudinary.com')) {
      return url.replace(/\.(mp4|mov|avi)$/, '.jpg');
    }
    return null;
  }

  if (isAuthLoading) {
    return (
      <div
        className="h-screen flex flex-col items-center justify-center gap-4 ec-animate-in"
        style={{ background: "var(--background)", color: "var(--text-secondary)" }}
      >
        <Loader2 className="animate-spin" size={44} style={{ color: "var(--primary)" }} />
        <p className="ec-section-sub text-base font-medium">Loading your studio…</p>
      </div>
    );
  }

  async function handlePasswordUpdate(e: any) {
    e.preventDefault();
    const currentPassword = e.target.currentPassword.value;
    const newPassword = e.target.newPassword.value;
    const confirmPassword = e.target.confirmPassword.value;
    if (newPassword !== confirmPassword) {
      warning('Passwords do not match', 'New password and confirm password must be identical.');
      return;
    }
    if (newPassword.length < 8) {
      warning('Password too short', 'New password must be at least 8 characters long.');
      return;
    }
    setIsSubmitting(true);
    // Step 1: Verify current password by re-authenticating
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user?.email || '',
      password: currentPassword,
    });
    if (authError) {
      toastError('Incorrect password', 'Current password is wrong. Please try again.');
      setIsSubmitting(false);
      return;
    }
    // Step 2: Update to new password
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toastError('Update failed', error.message);
    } else {
      success('Password updated!', 'Please re-login on all devices.');
      e.target.reset();
      // Sign out all other sessions by signing out and back in
      await supabase.auth.signOut({ scope: 'others' });
    }
    setIsSubmitting(false);
  }

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
    <div className="ec-layout font-sans">
      
      {/* Photographer delete confirm dialog */}
      <AlertDialog
        open={deletePhotographerPending !== null}
        title="Delete photographer credit?"
        message="This will remove the studio credit permanently. Existing events will not be affected, but future edits will lose this photographer info."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => { if (deletePhotographerPending) confirmDeletePhotographer(deletePhotographerPending); setDeletePhotographerPending(null); }}
        onCancel={() => setDeletePhotographerPending(null)}
      />

      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        handleSignOut={handleSignOut}
        isMobileOpen={isMobileMenuOpen}
        setIsMobileOpen={setIsMobileMenuOpen}
        isSuperAdmin={isSuperAdmin}
        userPlan={userPlan}
      />

      <div className="ec-main relative z-10">
        {/* Mobile Header — visible only ≤768px (see globals.css .ec-topbar-mobile) */}
        <header className="ec-topbar ec-topbar-mobile">
          <div className="ec-topbar-left">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20"
              style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--violet-500) 100%)" }}
            >
              <Layout size={18} />
            </div>
            <div>
              <h1 className="font-black tracking-tighter text-lg leading-none" style={{ color: "var(--foreground)" }}>EVENTCAST</h1>
              <p className="text-[9px] font-black tracking-[0.2em] uppercase mt-1" style={{ color: "var(--primary)" }}>ADMIN CONTROL</p>
            </div>
          </div>
          <button
            type="button"
            className="ec-icon-btn ec-topbar-menu-btn"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={isMobileMenuOpen}
          >
            <Menu size={20} />
          </button>
        </header>

        {/* Desktop Header — visible only ≥769px */}
        <header className="ec-topbar ec-topbar-desktop">
          <div className="ec-topbar-left">
             <div className="flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
               <Shield size={14} />
               <span className="text-[10px] font-black uppercase tracking-[0.2em]">Secure Session Active</span>
             </div>
          </div>
          <div className="ec-topbar-right">
             <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
               Studio Code: <span style={{ color: "var(--foreground)" }}>{studioSlug || 'N/A'}</span>
             </span>
          </div>
        </header>

        <main className="ec-content ec-scrollbar relative overflow-x-hidden">

        {activeTab === "home" && (
          <DashboardHome 
            events={events} 
            wishes={wishes} 
            analyticsData={analyticsData} 
            setActiveTab={setActiveTab}
            studioId={studioId}
            isSuperAdmin={isSuperAdmin}
            userPlan={userPlan}
          />
        )}
        {activeTab === "monitor" && <LiveMonitor events={events} wishes={wishes} />}
        {activeTab === "create" && (
          <CreateEventFlow 
            studioId={studioId!} 
            studioSlug={studioSlug!}
            initialData={isEditing ? formData : null}
            isEditing={isEditing}
            onComplete={() => {
              setActiveTab("list");
              fetchEvents();
              resetForm();
            }}
          />
        )}

        {activeTab === "list" && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-end pr-4">
              <button 
                onClick={() => setShowArchived(!showArchived)}
                className={showArchived ? 'ec-btn ec-btn-primary ec-btn-sm' : 'ec-btn ec-btn-secondary ec-btn-sm'}
              >
                {showArchived ? 'View Active Events' : 'View Archived Events'}
              </button>
            </div>
            <EventTable 
              events={events.filter(e => showArchived ? e.archived_at : !e.archived_at)} 
              wishes={wishes}
              isLoadingEvents={isLoadingEvents} 
              fetchEvents={fetchEvents} 
              handleEditClick={handleEditClick} 
              handleDuplicateClick={handleDuplicateClick}
              fullDeleteEvent={fullDeleteEvent} 
              deleteMultipleEvents={deleteMultipleEvents}
              isArchiveView={showArchived}
              restoreEvent={restoreEvent}
            />
          </div>
        )}
        {activeTab === "moderation" && <WishesModeration wishes={wishes} isLoadingWishes={isLoadingWishes} fetchWishes={fetchWishes} deleteWish={deleteWish} />}
        {activeTab === "guest-wall" && <GuestPhotoModeration />}
        {activeTab === "analytics" && <AnalyticsDashboard analyticsData={analyticsData} />}
        {activeTab === "assets" && <AssetLibrary assetLibrary={assetLibrary} getVideoThumbnail={getVideoThumbnail} setSelectedAsset={setSelectedAsset} />}
        {activeTab === "settings" && (
          <UserSettings studioId={studioId} studioSlug={studioSlug} user={user} />
        )}
        {activeTab === "billing" && (
          <Wallet studioId={studioId} />
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-500" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div
            className="ec-card w-full max-w-lg overflow-hidden relative animate-in zoom-in-95 duration-500"
            style={{ padding: 0 }}
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />
            
            <div className="p-8 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <div>
                <h3 className="text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>Mission readiness</h3>
                <p className="ec-section-sub mt-1">System health scan report</p>
              </div>
              <button type="button" onClick={() => setShowHealthCheck(false)} className="ec-icon-btn" aria-label="Close">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-8 space-y-5 max-h-[450px] overflow-y-auto ec-scrollbar">
              {healthResults.length === 0 ? (
                <div className="text-center py-12 animate-in zoom-in-90 duration-700">
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
                    style={{ background: "var(--success-50)", color: "var(--success)", border: "2px solid #A7F3D0" }}
                  >
                    <CheckCircle2 size={40} className="animate-pulse" />
                  </div>
                  <h4 className="text-xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>All systems optimal</h4>
                  <p className="ec-section-sub mt-2">Ready for deployment</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {healthResults.map((issue, idx) => (
                    <div key={idx} className={`p-5 rounded-xl flex items-start gap-4 border transition-all animate-in slide-in-from-bottom-2 duration-500 ${
                      issue.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 
                      issue.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' : 
                      'bg-blue-50 border-blue-200 text-blue-700'
                    }`} style={{ animationDelay: `${idx * 100}ms` }}>
                      <div className={`mt-0.5 w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        issue.type === 'error' ? 'bg-red-100' : 
                        issue.type === 'warning' ? 'bg-amber-100' : 
                        'bg-blue-100'
                      }`}>
                        {issue.type === 'error' ? <AlertCircle size={20} /> : 
                         issue.type === 'warning' ? <AlertTriangle size={20} /> : 
                         <CheckCircle2 size={20} />}
                      </div>
                      <div>
                        <p className="ec-label mb-1 capitalize">{issue.type}</p>
                        <p className="text-sm font-semibold leading-relaxed">{issue.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="p-8" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <button 
                type="button"
                onClick={() => setShowHealthCheck(false)} 
                className="ec-btn ec-btn-lg ec-btn-primary w-full text-white"
              >
                Acknowledge &amp; close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// Trigger deployment

