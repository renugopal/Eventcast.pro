"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Users, Settings, PlusCircle, LayoutDashboard, Video, MapPin, UploadCloud, Image as ImageIcon, Search, CheckCircle2, Loader2, AlertCircle, Clock, Film, Link, Trash2, Edit, ExternalLink, Play, RefreshCw, Heart, BarChart2, HelpCircle, Download, X, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("create");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<string | null>(null); // Track which field is uploading
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("All");
  
  const [analyticsData, setAnalyticsData] = useState<any[]>([]);
  const [detailedViews, setDetailedViews] = useState<any[]>([]);
  const [selectedEventForAnalytics, setSelectedEventForAnalytics] = useState<any>(null);
  const [assetLibrary, setAssetLibrary] = useState<any[]>([]);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Auth Guard
  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
      } else {
        setIsAuthLoading(false);
      }
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.push("/login");
    });

    return () => subscription.unsubscribe();
  }, [router]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [formData, setFormData] = useState({
    eventType: "Wedding",
    groomName: "",
    brideName: "",
    celebrantName: "",
    customTopTitle: "",
    eventDate: new Date().toISOString().split('T')[0],
    eventTime: "", // Sumuhurtham
    timerTargetTime: "", // Separate field for the countdown timer
    showTimer: true,
    venueName: "",
    venueMapLink: "",
    invitationVideoUrl: "", // Now a direct Cloudinary URL
    thumbnailUrl: "", // Now a direct Cloudinary URL
    privacyStatus: "Unlisted (Link Only)",
    galleryUrls: "",
    vodLink: "",
    templateId: "wedding-template-01",
    youtubePrivacy: "public",
    autoGenerateThumbnail: true // Default to true
  });
  
  // Photographer Logic
  const [photographers, setPhotographers] = useState<any[]>([]);
  const [photographerSearchQuery, setPhotographerSearchQuery] = useState("");
  const [selectedPhotographer, setSelectedPhotographer] = useState<any>(null);
  const [showPhotographerList, setShowPhotographerList] = useState(false);
  
  // Events Logic
  const [events, setEvents] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  
  // Base Thumbnails for Auto-Design with Smart Styling
  const baseDesigns = [
    { id: "base_thumbnails/base_thumbnails/b421a3bc-10fb-4968-87d3-fc7e5902b55a", name: "Floral Classic", font: "Aref%20Ruqaa", nameColor: "C2185B", typeColor: "666666" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_496fib496fib496f", name: "Modern Blush", font: "Inter", nameColor: "D81B60", typeColor: "444444" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_dki6mhdki6mhdki6", name: "Vintage Sage", font: "Aref%20Ruqaa", nameColor: "2E7D32", typeColor: "333333" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_h4x887h4x887h4x8", name: "Royal Maroon", font: "Inter", nameColor: "FFD700", typeColor: "FFFFFF" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_nukskenukskenuks", name: "Golden Frame", font: "Aref%20Ruqaa", nameColor: "8E24AA", typeColor: "000000" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_qkvc8rqkvc8rqkvc", name: "Elegant White", font: "Inter", nameColor: "1E88E5", typeColor: "555555" },
    { id: "base_thumbnails/base_thumbnails/Gemini_Generated_Image_rc16u6rc16u6rc16", name: "Artistic Pastel", font: "Aref%20Ruqaa", nameColor: "FB8C00", typeColor: "444444" }
  ];
  const [selectedBaseDesign, setSelectedBaseDesign] = useState(baseDesigns[0].id);
  
  // Wishes Logic
  const [wishes, setWishes] = useState<any[]>([]);
  const [isLoadingWishes, setIsLoadingWishes] = useState(false);

  useEffect(() => {
    fetchPhotographers();
    fetchEvents();
    fetchWishes();
    fetchAnalytics();
    fetchAssets();
  }, []);

  async function fetchEvents() {
    setIsLoadingEvents(true);
    const { data, error } = await supabase
      .from('events')
      .select('*, photographers(*)')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching events:', error);
    } else {
      setEvents(data || []);
    }
    setIsLoadingEvents(false);
  }

  async function fetchAnalytics() {
    setIsLoadingAnalytics(true);
    const { data: eventStats } = await supabase
      .from('events')
      .select('id, groom_name, bride_name, celebrant_name, event_type, view_count, event_date')
      .order('view_count', { ascending: false });
    
    const { data: views } = await supabase
      .from('page_views')
      .select('*, events(groom_name, bride_name, celebrant_name, event_type)')
      .order('created_at', { ascending: false });

    if (eventStats) setAnalyticsData(eventStats);
    if (views) setDetailedViews(views);
    setIsLoadingAnalytics(false);
  }

  async function fetchAssets() {
    setIsLoadingAssets(true);
    const { data, error } = await supabase
      .from('events')
      .select('thumbnail_url, invitation_video_url, gallery_urls');
    
    if (!error && data) {
      const allAssets = new Set<string>();
      data.forEach(row => {
        if (row.thumbnail_url) allAssets.add(row.thumbnail_url);
        if (row.invitation_video_url) allAssets.add(row.invitation_video_url);
        if (Array.isArray(row.gallery_urls)) {
          row.gallery_urls.forEach((url: string) => allAssets.add(url));
        }
      });
      setAssetLibrary(Array.from(allAssets));
    }
    setIsLoadingAssets(false);
  }

  const getVideoThumbnail = (url: string) => {
    if (url.includes('/video/upload/')) {
      // Cloudinary video thumbnail trick: change extension to .jpg
      return url.replace(/\.[^/.]+$/, ".jpg");
    }
    return null;
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
            // Extracts the part between /place/ and the next /
            // Usually contains Venue Name + City (e.g. Venue+Name,+City)
            extractedName = link.split('/place/')[1].split('/')[0];
          } else if (link.includes('q=')) {
            extractedName = new URL(link).searchParams.get('q') || "";
          }

          if (extractedName) {
            // Replace + with space and decode
            const decodedName = decodeURIComponent(extractedName.replace(/\+/g, ' '));
            
            // Clean up: Remove any trailing @ coordinates or trailing commas
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

  const exportToCSV = () => {
    const headers = ["ID", "Groom", "Bride", "Event Type", "Date", "Venue", "Views", "Status"];
    const rows = events.map(e => [
      e.id, 
      e.groom_name || e.celebrant_name, 
      e.bride_name || 'Family', 
      e.event_type, 
      e.event_date, 
      e.venue_name, 
      e.view_count || 0, 
      e.status || 'Active'
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(r => r.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `eventcast_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
  };

  const filteredEvents = events.filter(e => {
    const name = `${e.groom_name} ${e.bride_name} ${e.celebrant_name}`.toLowerCase();
    const matchesSearch = name.includes(searchQuery.toLowerCase()) || (e.venue_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === "All" || e.event_type === filterType;
    return matchesSearch && matchesFilter;
  });

  async function deleteEvent(id: string) {
    if (!confirm("Are you sure you want to delete this event? This will ONLY remove the record from dashboard. YouTube and Photos will NOT be deleted.")) return;
    
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', id);

    if (error) {
      alert("Error deleting event: " + error.message);
    } else {
      setEvents(prev => prev.filter(e => e.id !== id));
    }
  }

  async function fullDeleteEvent(id: string) {
    if (!confirm("⚠️ WARNING: FULL DELETE! This will permanently delete the website record, the YouTube Live event, and ALL photos/videos from Cloudinary. This cannot be undone. Proceed?")) return;
    
    setIsLoadingEvents(true);
    try {
      const res = await fetch('/api/events/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: id })
      });
      const data = await res.json();
      if (data.success) {
        setEvents(prev => prev.filter(e => e.id !== id));
        alert("Full wipe complete. Everything deleted.");
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      alert("Full delete failed.");
    } finally {
      setIsLoadingEvents(false);
    }
  }

  async function generateWebsite(event: any) {
    setIsLoadingEvents(true);
    try {
      const res = await fetch('/api/events/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
      const data = await res.json();
      if (data.success) {
        alert(`Website generated successfully!\nURL: ${data.url}`);
      } else {
        alert("Generation failed: " + data.error);
      }
    } catch (err) {
      alert("Website generation failed.");
    } finally {
      setIsLoadingEvents(false);
    }
  }

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
    
    // Find photographer if any
    const pg = photographers.find(p => p.id === event.photographer_id);
    if (pg) setSelectedPhotographer(pg);
    
    setActiveTab("create");
  };

  async function fetchWishes() {
    setIsLoadingWishes(true);
    // Try with join first
    const { data, error } = await supabase
      .from('wishes')
      .select('*, events(groom_name, bride_name, celebrant_name, event_type)')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.warn('Wishes join failed, trying simple select:', error.message);
      // Fallback to simple select
      const { data: simpleData, error: simpleError } = await supabase
        .from('wishes')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (simpleError) {
        console.error('Error fetching wishes (fallback):', simpleError.message);
      } else {
        setWishes(simpleData || []);
      }
    } else {
      setWishes(data || []);
    }
    setIsLoadingWishes(false);
  }

  async function deleteWish(id: string) {
    if (!confirm("Are you sure you want to delete this wish?")) return;
    
    const { error } = await supabase
      .from('wishes')
      .delete()
      .eq('id', id);

    if (error) {
      alert("Error deleting wish: " + error.message);
    } else {
      setWishes(prev => prev.filter(w => w.id !== id));
    }
  }

  async function fetchPhotographers() {
    const { data, error } = await supabase
      .from('photographers')
      .select('*');
    
    if (error) {
      console.error('Error fetching photographers:', error);
    } else {
      setPhotographers(data || []);
    }
  }

  const filteredPhotographers = photographers.filter(p => 
    p.name.toLowerCase().includes(photographerSearchQuery.toLowerCase()) ||
    p.city?.toLowerCase().includes(photographerSearchQuery.toLowerCase()) ||
    p.phone_number?.includes(photographerSearchQuery)
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: val }));
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

  const uploadToCloudinary = async (files: FileList | null, fieldName: 'gallery' | 'video' | 'thumbnail' | 'logo') => {
    if (!files || files.length === 0) return;
    setIsUploading(fieldName);

    try {
      // 1. Get Signature
      const sigRes = await fetch('/api/cloudinary-signature', { method: 'POST' });
      const { timestamp, signature } = await sigRes.json();

      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
      const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

      const results: string[] = [];
      for (let i = 0; i < files.length; i++) {
        let fileToUpload: File | Blob = files[i];
        
        // Auto-compress images if they are high res
        if (fieldName !== 'video') {
          fileToUpload = await compressImage(files[i]);
        }

        const formDataObj = new FormData();
        formDataObj.append("file", fileToUpload);
        formDataObj.append("upload_preset", uploadPreset!);
        
        // Correctly set resource_type for videos
        if (fieldName === "video") {
          formDataObj.append("resource_type", "video");
        }

        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${fieldName === 'video' ? 'video' : 'image'}/upload`, {
          method: "POST",
          body: formDataObj
        });

        const data = await res.json();
        if (data.secure_url) {
          results.push(data.secure_url);
        } else if (data.error) {
          console.error("Cloudinary Error:", data.error.message);
          alert(`Upload failed: ${data.error.message}`);
        }
      }

      if (fieldName === "gallery") {
        const currentUrls = formData.galleryUrls.trim();
        const newUrls = results.join("\n");
        setFormData(prev => ({ ...prev, galleryUrls: currentUrls ? `${currentUrls}\n${newUrls}` : newUrls }));
      } else if (fieldName === "video") {
        setFormData(prev => ({ ...prev, invitationVideoUrl: results[0] }));
      } else if (fieldName === "thumbnail") {
        setFormData(prev => ({ ...prev, thumbnailUrl: results[0] }));
      }
      
    } catch (err) {
      console.error("Upload error:", err);
      alert("Upload failed. Please check your Cloudinary settings.");
    } finally {
      setIsUploading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      // 1. Automate YouTube Live Creation (Only if not editing or explicitly requested)
      let youtubeUrl = "";
      let streamKey = "";
      try {
        const ytResponse = await fetch('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groomName: formData.groomName,
            brideName: formData.brideName,
            celebrantName: formData.celebrantName,
            eventType: formData.eventType,
            eventDate: formData.eventDate,
            targetTime: formData.timerTargetTime || formData.eventTime,
            venueName: formData.venueName,
            thumbnailUrl: formData.thumbnailUrl,
            privacy: formData.youtubePrivacy
          })
        });

        const ytData = await ytResponse.json();
        if (ytData.success) {
          youtubeUrl = ytData.youtubeUrl;
          streamKey = ytData.streamKey;
        }
      } catch (ytErr) {
        console.error("YouTube Automation failed, but continuing with database save:", ytErr);
      }

      // 2. Add or Update Supabase Entry
      let dbError;
      let eventId = editingId;

      const slug = `${(formData.groomName || formData.celebrantName || '').toLowerCase().replace(/\s+/g, '-')}-${(formData.brideName || 'family').toLowerCase().replace(/\s+/g, '-')}-${(formData.eventType || '').toLowerCase()}-${Date.now().toString().slice(-4)}`;

      // 0. Auto-generate Thumbnail if enabled
      let finalThumbnailUrl = formData.thumbnailUrl;
      // @ts-ignore
      if (formData.autoGenerateThumbnail && !finalThumbnailUrl) {
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const baseImageId = selectedBaseDesign;
        const currentDesign = baseDesigns.find(d => d.id === selectedBaseDesign) || baseDesigns[0];
        
        const names = encodeURIComponent(`${formData.groomName || formData.celebrantName} & ${formData.brideName || 'Family'}`);
        const eventTypeText = encodeURIComponent(`${formData.eventType} Live`);
        
        finalThumbnailUrl = `https://res.cloudinary.com/${cloudName}/image/upload/` + 
          `w_1280,h_720,c_fill/` + 
          `l_text:${currentDesign.font}_80_bold:${names},g_center,y_-40,co_rgb:${currentDesign.nameColor}/` +
          `l_text:Inter_40_medium:${eventTypeText},g_center,y_60,co_rgb:${currentDesign.typeColor}/` +
          `${baseImageId}.jpg`;
      }

      const eventData = {
        event_type: formData.eventType,
        groom_name: formData.groomName,
        bride_name: formData.brideName,
        celebrant_name: formData.celebrantName,
        custom_top_title: formData.customTopTitle,
        event_date: formData.eventDate,
        event_time: formData.eventTime,
        timer_target_time: formData.timerTargetTime,
        show_timer: formData.showTimer,
        venue_name: formData.venueName,
        venue_map_link: formData.venueMapLink,
        invitation_video_url: formData.invitationVideoUrl,
        thumbnail_url: formData.thumbnailUrl,
        privacy_status: formData.privacyStatus,
        gallery_urls: formData.galleryUrls.split('\n').filter(url => url.trim() !== ""),
        vod_link: youtubeUrl || formData.vodLink,
        stream_key: streamKey,
        slug: slug,
        photographer_id: selectedPhotographer?.id,
        template_id: formData.templateId,
        status: 'Active'
      };

      if (isEditing && editingId) {
        const { error } = await supabase
          .from('events')
          .update(eventData)
          .eq('id', editingId);
        dbError = error;
      } else {
        const { data, error } = await supabase
          .from('events')
          .insert([eventData])
          .select();
        dbError = error;
        if (data) eventId = data[0].id;
      }

      if (dbError) throw dbError;

      // 3. Generate Website Files and Push to Git
      let publicUrl = "";
      try {
        const res = await fetch('/api/events/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...eventData, id: eventId, photographer: selectedPhotographer })
        });
        const genData = await res.json();
        if (genData.success) {
          publicUrl = genData.url;
        }
      } catch (genErr) {
        console.error("Website Generation failed:", genErr);
      }

      setSubmitStatus({ 
        type: 'success', 
        message: `Success! ${isEditing ? 'Event Updated.' : 'Event Created.'} ${youtubeUrl ? 'YouTube Live Scheduled.' : ''} ${publicUrl ? 'Website files pushed to GitHub.' : ''}` 
      });

      fetchEvents(); // Refresh table
      
      // Reset form
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
      setPhotographerSearchQuery("");

    } catch (error: any) {
      console.error('Error creating event:', error);
      setSubmitStatus({ type: 'error', message: error.message || 'Failed to create event.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add Photographer Form State
  const [newPhotographer, setNewPhotographer] = useState({
    name: "",
    ownerName: "",
    city: "",
    phone_number: "",
    instagram_url: "",
    logo_url: ""
  });

  const handlePhotographerInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setNewPhotographer(prev => ({ ...prev, [name]: value }));
  };

  const handlePhotographerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('photographers')
        .insert([{
          name: newPhotographer.name,
          owner_name: newPhotographer.ownerName,
          city: newPhotographer.city,
          phone_number: newPhotographer.phone_number,
          instagram_url: newPhotographer.instagram_url,
          logo_url: newPhotographer.logo_url
        }]);

      if (error) throw error;
      alert("Photographer added successfully!");
      setNewPhotographer({ name: "", ownerName: "", city: "", phone_number: "", instagram_url: "", logo_url: "" });
      fetchPhotographers(); // Refresh the list
    } catch (err: any) {
      alert("Error adding photographer: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadLogoToCloudinary = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading("logo");
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

    try {
      const formDataObj = new FormData();
      formDataObj.append("file", files[0]);
      formDataObj.append("upload_preset", uploadPreset!);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: "POST",
        body: formDataObj
      });

      const data = await res.json();
      if (data.secure_url) {
        setNewPhotographer(prev => ({ ...prev, logo_url: data.secure_url }));
      }
    } catch (err) {
      alert("Logo upload failed.");
    } finally {
      setIsUploading(null);
    }
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4 text-center p-6">
        <div className="relative w-24 h-24 mb-4">
          <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Video className="text-blue-500" size={32} />
          </div>
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight">Eventcast <span className="text-blue-500">PRO</span></h2>
        <p className="text-slate-400 font-medium animate-pulse">Initializing Secure Session...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      {/* Sidebar (Same as before) */}
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col shadow-xl">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 text-blue-400">
            <Video size={28} /> Eventcast <span className="text-xs bg-blue-500/20 px-1.5 py-0.5 rounded text-blue-300">PRO</span>
          </h1>
        </div>
        <nav className="flex-1 p-4 space-y-2 mt-4">
          <button type="button" onClick={() => setActiveTab("dashboard")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === "dashboard" ? "bg-blue-600 shadow-lg shadow-blue-900/20" : "hover:bg-slate-800"}`}>
            <LayoutDashboard size={20} /> Dashboard
          </button>
          <button type="button" onClick={() => setActiveTab("create")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === "create" ? "bg-blue-600 shadow-lg shadow-blue-900/20" : "hover:bg-slate-800"}`}>
            <PlusCircle size={20} /> Create Event
          </button>
          <button type="button" onClick={() => setActiveTab("moderation")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === "moderation" ? "bg-blue-600 shadow-lg shadow-blue-900/20" : "hover:bg-slate-800"}`}>
            <Heart size={20} /> Moderation
          </button>
          <button type="button" onClick={() => setActiveTab("analytics")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === "analytics" ? "bg-blue-600 shadow-lg shadow-blue-900/20" : "hover:bg-slate-800"}`}>
            <LayoutDashboard size={20} /> Analytics
          </button>
          <button type="button" onClick={() => setActiveTab("assets")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === "assets" ? "bg-blue-600 shadow-lg shadow-blue-900/20" : "hover:bg-slate-800"}`}>
            <ImageIcon size={20} /> Asset Library
          </button>
          <button type="button" onClick={() => setActiveTab("photographers")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === "photographers" ? "bg-blue-600 shadow-lg shadow-blue-900/20" : "hover:bg-slate-800"}`}>
            <Users size={20} /> Photographers
          </button>
          <button type="button" onClick={() => setActiveTab("settings")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === "settings" ? "bg-blue-600 shadow-lg shadow-blue-900/20" : "hover:bg-slate-800"}`}>
            <Settings size={20} /> Settings
          </button>
          <button type="button" onClick={() => setActiveTab("help")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === "help" ? "bg-blue-600 shadow-lg shadow-blue-900/20" : "hover:bg-slate-800"}`}>
            <HelpCircle size={20} /> Help & Guide
          </button>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button 
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all"
          >
            <LogOut size={20} /> Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <header className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold text-slate-800">
            {activeTab === "create" ? "Create New Event" : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-500">Admin: Renugopal</span>
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold border-2 border-blue-200">R</div>
          </div>
        </header>

        {activeTab === "dashboard" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center mb-2">
              <div>
                <p className="text-slate-500 text-sm">Welcome back, here's what's happening with your events.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Search events or venues..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 w-64"
                  />
                  <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
                </div>
                <select 
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option>All</option>
                  <option>Wedding</option>
                  <option>Engagement</option>
                  <option>Birthday</option>
                  <option>Other</option>
                </select>
                <button onClick={exportToCSV} className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-bold hover:bg-blue-100 transition-all">
                  <Download size={16} /> Export CSV
                </button>
                <button onClick={fetchEvents} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 transition-all shadow-sm">
                  <RefreshCw size={16} className={isLoadingEvents ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100">
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Event Details</th>
                      <th className="hidden md:table-cell p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Type</th>
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Date & Time</th>
                      <th className="hidden md:table-cell p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Venue</th>
                      <th className="hidden md:table-cell p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Views</th>
                      <th className="hidden md:table-cell p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">QR</th>
                      <th className="hidden lg:table-cell p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stream Key</th>
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Live</th>
                      <th className="hidden sm:table-cell p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEvents.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-12 text-center">
                          <div className="flex flex-col items-center gap-2 text-slate-400">
                            <LayoutDashboard size={48} strokeWidth={1} />
                            <p>No matches found for your search.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredEvents.map((event) => (
                        <tr key={event.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${event.event_type === 'Wedding' ? 'bg-pink-50 text-pink-500' : 'bg-blue-50 text-blue-500'}`}>
                                {event.event_type === 'Wedding' ? <Heart size={18} /> : <Calendar size={18} />}
                              </div>
                              <div>
                                <p className="font-bold text-slate-800 leading-tight">
                                  {event.groom_name || event.celebrant_name} {event.bride_name ? `& ${event.bride_name}` : ''}
                                </p>
                                <p className="text-[10px] text-slate-400 font-mono mt-0.5 md:hidden">{event.event_type}</p>
                              </div>
                            </div>
                          </td>
                          <td className="hidden md:table-cell p-4">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              event.event_type === 'Wedding' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {event.event_type}
                            </span>
                          </td>
                          <td className="p-4 text-xs text-slate-600">
                            <div className="font-medium">{event.event_date}</div>
                            <div className="text-slate-400 mt-0.5 flex items-center gap-1"><Clock size={10} /> {event.event_time}</div>
                          </td>
                          <td className="hidden md:table-cell p-4 text-xs text-slate-600 max-w-[150px] truncate">
                            <div className="flex items-center gap-1"><MapPin size={12} className="text-slate-400" /> {event.venue_name}</div>
                          </td>
                          <td className="hidden md:table-cell p-4 text-center">
                            <span className="font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold">{event.view_count || 0}</span>
                          </td>
                          <td className="hidden md:table-cell p-4 text-center">
                             <a 
                               href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://eventcast.pro/events/${(event.groom_name || event.celebrant_name || '').toLowerCase().replace(/\s+/g, '-')}-${(event.bride_name || 'family').toLowerCase().replace(/\s+/g, '-')}-${(event.event_type || '').toLowerCase()}`} 
                               target="_blank" 
                               className="text-blue-500 hover:text-blue-700 transition-colors"
                             >
                               <MapPin size={16} className="mx-auto" />
                             </a>
                          </td>
                          <td className="hidden lg:table-cell p-4">
                            {event.stream_key ? (
                              <div className="flex items-center gap-2">
                                <code className="bg-slate-100 px-2 py-1 rounded text-[10px] font-mono text-slate-700">{event.stream_key}</code>
                                <button 
                                  onClick={() => { navigator.clipboard.writeText(event.stream_key); alert("Stream Key Copied!"); }}
                                  className="text-slate-400 hover:text-blue-500 transition-colors"
                                  title="Copy Stream Key"
                                >
                                  <Link size={12} />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400">---</span>
                            )}
                          </td>
                          <td className="p-4">
                            {event.vod_link ? (
                              <a href={event.vod_link} target="_blank" className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-bold text-[10px] uppercase">
                                <Play size={14} /> View Live
                              </a>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-medium">PENDING</span>
                            )}
                          </td>
                          <td className="hidden sm:table-cell p-4">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-50 text-green-600 rounded-full text-[10px] font-bold uppercase">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                              {event.status || 'Active'}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => generateWebsite(event)} className="p-2 hover:bg-purple-50 text-purple-600 rounded-lg transition-colors" title="Generate/Push Website">
                                <RefreshCw size={18} />
                              </button>
                                <a 
                                  href={`https://eventcast.pro/events/${event.slug || ''}`} 
                                  target="_blank" 
                                  className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors" 
                                  title="View Public Page"
                                >
                                  <ExternalLink size={18} />
                                </a>
                              <button onClick={() => handleEditClick(event)} className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors" title="Edit Event">
                                <Edit size={18} />
                              </button>
                              
                              {event.photographers && event.photographers.phone_number && (
                                <button 
                                  onClick={() => {
                                    const message = `Hello ${event.photographers.name}! Your event is ready: https://eventcast.pro/events/${event.slug}`;
                                    window.open(`https://wa.me/${event.photographers.phone_number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank');
                                  }} 
                                  className="p-2 hover:bg-green-50 text-green-600 rounded-lg transition-colors" 
                                  title="Share to Photographer via WhatsApp"
                                >
                                  <Video size={18} />
                                </button>
                              )}

                              <button onClick={() => deleteEvent(event.id)} className="p-2 hover:bg-orange-50 text-orange-600 rounded-lg transition-colors" title="Simple Delete (Dashboard Only)">
                                <Trash2 size={18} />
                              </button>
                              <button onClick={() => fullDeleteEvent(event.id)} className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors border border-transparent hover:border-red-200" title="FULL DELETE (Website + YT + Cloudinary)">
                                <AlertCircle size={18} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "moderation" && (
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-800">Wishes Moderation</h2>
              <button onClick={fetchWishes} className="p-2 bg-white border rounded-lg hover:bg-slate-50">
                <RefreshCw size={20} className={isLoadingWishes ? 'animate-spin' : ''} />
              </button>
            </div>
            
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">Event</th>
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">From</th>
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">Message</th>
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">Date</th>
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {wishes.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-slate-400">No wishes to moderate.</td></tr>
                    ) : (
                      wishes.map(wish => (
                        <tr key={wish.id} className="hover:bg-slate-50/50 group">
                          <td className="p-4 text-xs font-bold text-slate-700">
                            {wish.events ? (
                              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                                {wish.events.groom_name || wish.events.celebrant_name}
                              </span>
                            ) : (
                              <span className="text-slate-400">Unknown Event</span>
                            )}
                          </td>
                          <td className="p-4 text-xs font-bold text-slate-800">{wish.name}</td>
                          <td className="p-4 text-xs text-slate-600 max-w-md italic">"{wish.message}"</td>
                          <td className="p-4 text-[10px] text-slate-400 font-mono">
                            {new Date(wish.created_at).toLocaleString()}
                          </td>
                          <td className="p-4 text-right">
                            <button onClick={() => deleteWish(wish.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "analytics" && (
          <div className="max-w-6xl mx-auto space-y-8">
            <h2 className="text-2xl font-bold text-slate-800">Advanced Analytics</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Views</p>
                <p className="text-3xl font-black text-slate-800">{analyticsData.reduce((acc, curr) => acc + (curr.view_count || 0), 0)}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Avg Views / Event</p>
                <p className="text-3xl font-black text-blue-600">
                  {analyticsData.length > 0 ? Math.round(analyticsData.reduce((acc, curr) => acc + (curr.view_count || 0), 0) / analyticsData.length) : 0}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
               <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">Event</th>
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase text-center">Views</th>
                      <th className="p-4 text-[11px] font-bold text-slate-500 uppercase">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {analyticsData.map((data, i) => (
                      <tr key={i} className="hover:bg-slate-50/50">
                        <td className="p-4 text-xs font-bold text-slate-800">
                          {data.groom_name || data.celebrant_name} ({data.event_type})
                        </td>
                        <td className="p-4 text-center font-mono font-bold text-blue-600">{data.view_count || 0}</td>
                        <td className="p-4">
                           <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="bg-blue-500 h-full rounded-full" 
                                style={{ width: `${Math.min(100, (data.view_count / 1000) * 100)}%` }} 
                              />
                           </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
               </table>
            </div>
          </div>
        )}

        {activeTab === "assets" && (
          <div className="max-w-6xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold text-slate-800">Asset Library</h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {assetLibrary.map((item, i) => {
                const url = typeof item === 'string' ? item : item?.url || item?.secure_url || '';
                if (!url) return null;
                const isVideo = url.toLowerCase().endsWith('.mp4') || url.toLowerCase().endsWith('.mov') || url.includes('/video/upload/');
                const videoThumb = isVideo ? getVideoThumbnail(url) : null;

                return (
                  <div key={i} className="aspect-square bg-slate-100 rounded-xl overflow-hidden border border-slate-200 group relative cursor-zoom-in" onClick={() => setSelectedAsset(url)}>
                    {isVideo ? (
                      <div className="w-full h-full relative">
                        {videoThumb ? (
                          <img src={videoThumb} className="w-full h-full object-cover" alt="Video Thumbnail" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-indigo-50 text-indigo-500 gap-2">
                            <Film size={32} />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Video File</span>
                          </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-10 h-10 bg-black/40 rounded-full flex items-center justify-center text-white backdrop-blur-sm">
                            <Play size={20} fill="currentColor" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <img src={url} className="w-full h-full object-cover" />
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(url); alert("URL Copied!"); }} className="p-2 bg-white rounded-lg text-slate-800 hover:bg-blue-50 transition-colors">
                        <Link size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {assetLibrary.length === 0 && <div className="col-span-full p-12 text-center text-slate-400">No assets found in previous events.</div>}
            </div>
          </div>
        )}

        {activeTab === "photographers" && (
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><PlusCircle className="text-blue-600" /> Register New Photographer</h3>
              <form onSubmit={handlePhotographerSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Studio Name</label>
                  <input type="text" name="name" value={newPhotographer.name} onChange={handlePhotographerInputChange} placeholder="e.g. Ashok Wedding Studios" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Owner Name</label>
                  <input type="text" name="ownerName" value={newPhotographer.ownerName} onChange={handlePhotographerInputChange} placeholder="e.g. Ashok Kumar" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Area / City</label>
                  <input type="text" name="city" value={newPhotographer.city} onChange={handlePhotographerInputChange} placeholder="e.g. Guntur" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                  <input type="text" name="phone_number" value={newPhotographer.phone_number} onChange={handlePhotographerInputChange} placeholder="e.g. 9010111092" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Instagram Link / ID</label>
                  <input type="text" name="instagram_url" value={newPhotographer.instagram_url} onChange={handlePhotographerInputChange} placeholder="e.g. https://instagram.com/..." className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Studio Logo</label>
                  <div className="flex gap-2">
                    <input type="text" value={newPhotographer.logo_url} readOnly placeholder="Upload or paste URL..." className="flex-1 p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs" />
                    <button type="button" onClick={() => thumbInputRef.current?.click()} className="bg-blue-600 text-white p-2.5 rounded-lg hover:bg-blue-700">
                      {isUploading === 'logo' ? <Loader2 className="animate-spin" size={18} /> : <UploadCloud size={18} />}
                    </button>
                  </div>
                  <input type="file" ref={thumbInputRef} hidden accept="image/*" onChange={(e) => uploadLogoToCloudinary(e.target.files)} />
                </div>
                <div className="md:col-span-2 pt-4">
                  <button type="submit" disabled={isSubmitting} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg disabled:bg-slate-400">
                    {isSubmitting ? "Registering..." : "Add Photographer to System"}
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
              <h3 className="text-xl font-bold mb-6">Registered Photographers</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {photographers.map(p => (
                  <div key={p.id} className="p-4 border rounded-xl flex items-center gap-4 hover:border-blue-300 transition-colors">
                    {p.logo_url ? (
                      <img src={p.logo_url} className="w-12 h-12 rounded object-contain bg-slate-50 p-1" alt={p.name} />
                    ) : (
                      <div className="w-12 h-12 rounded bg-blue-100 text-blue-600 flex items-center justify-center font-bold">{p.name.substring(0, 2).toUpperCase()}</div>
                    )}
                    <div>
                      <p className="font-bold text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-500">{p.city} • {p.phone_number}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "create" && (
          <div className="max-w-5xl mx-auto pb-20">
            {submitStatus && (
              <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${submitStatus.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                {submitStatus.type === 'success' ? <CheckCircle2 className="text-green-500" /> : <AlertCircle className="text-red-500" />}
                <p className="font-medium">{submitStatus.message}</p>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
              <form onSubmit={handleSubmit} className="space-y-10">
                
                {/* 1. Event Identity */}
                <section>
                  <h3 className="text-lg font-semibold border-b pb-2 mb-4 flex items-center gap-2"><Calendar size={20} className="text-blue-500" /> Event Identity</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-1">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Custom Top Title (Welcome Text)</label>
                      <input type="text" name="customTopTitle" value={formData.customTopTitle} onChange={handleInputChange} placeholder="e.g. Welcome to Our Wedding" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                      <p className="text-[10px] text-slate-400 mt-1">Leave blank to use default.</p>
                    </div>

                    <div className="md:col-span-1">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Event Type</label>
                      <select name="eventType" value={formData.eventType} onChange={handleInputChange} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                        <option>Wedding</option>
                        <option>Engagement</option>
                        <option>Birthday</option>
                        <option>Half Saree</option>
                      </select>
                    </div>

                    <div className="md:col-span-1">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Visual Theme / Template</label>
                      <select name="templateId" value={formData.templateId} onChange={handleInputChange} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                        <option value="wedding-template-01">Wedding-theme-01 (Premium Pink & Gold)</option>
                        <option value="wedding-template">Modern Sage Theme (Green Botanical)</option>
                        <option value="wedding">Traditional Maroon Theme (Watercolor)</option>
                      </select>
                    </div>

                    {(formData.eventType === "Wedding" || formData.eventType === "Engagement") ? (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Groom Name</label>
                          <input type="text" name="groomName" value={formData.groomName} onChange={handleInputChange} placeholder="e.g. Dr. Vamsi" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Bride Name</label>
                          <input type="text" name="brideName" value={formData.brideName} onChange={handleInputChange} placeholder="e.g. Dr. Gayathri" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                        </div>
                      </>
                    ) : (
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Celebrant Name</label>
                        <input type="text" name="celebrantName" value={formData.celebrantName} onChange={handleInputChange} placeholder="e.g. Master Ishaan" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                      </div>
                    )}
                  </div>
                </section>

                {/* 2. Timing & Venue */}
                <section>
                  <h3 className="text-lg font-semibold border-b pb-2 mb-4 flex items-center gap-2"><Clock size={20} className="text-blue-500" /> Schedule & Timer</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Event Date</label>
                      <input type="date" name="eventDate" value={formData.eventDate} onChange={handleInputChange} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Sumuhurtham Time</label>
                      <input type="time" name="eventTime" value={formData.eventTime} onChange={handleInputChange} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Live Start Time (Timer & YouTube)</label>
                      <input type="time" name="timerTargetTime" value={formData.timerTargetTime} onChange={handleInputChange} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                      <p className="text-[10px] text-blue-500 mt-1 font-medium italic">Note: This time controls the Countdown Timer AND the YouTube Schedule.</p>
                    </div>
                    <div className="flex items-center gap-4 bg-blue-50 p-3 rounded-lg h-fit self-end">
                      <input type="checkbox" id="timer-toggle" name="showTimer" checked={formData.showTimer} onChange={handleInputChange} className="w-4 h-4 text-blue-600 rounded" />
                      <label htmlFor="timer-toggle" className="text-sm font-medium text-blue-800">Show Timer Circle</label>
                    </div>
                  </div>
                </section>

                {/* 3. Venue Details */}
                <section>
                  <h3 className="text-lg font-semibold border-b pb-2 mb-4 flex items-center gap-2"><MapPin size={20} className="text-blue-500" /> Venue & Location</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                          Venue Name / Address
                          {formData.venueMapLink && formData.venueMapLink.includes('place/') && (
                            <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider animate-pulse">Synced from Link</span>
                          )}
                        </label>
                        <textarea name="venueName" value={formData.venueName} onChange={handleInputChange} placeholder="e.g. Sri Prasannanjaneya Swamy Vari Kalyanamandapam, Boppudi Village" rows={2} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Google Maps Link (Optional)</label>
                        <input type="text" name="venueMapLink" value={formData.venueMapLink} onChange={handleInputChange} placeholder="Paste Google Maps URL here..." className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                        <p className="text-[10px] text-blue-500 mt-1 flex items-center gap-1 font-medium">
                          <CheckCircle2 size={10} /> Tip: Paste a Google Maps link to auto-fill the official name.
                        </p>
                      </div>
                    </div>
                    
                    <div className="bg-slate-100 rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center min-h-[150px] relative overflow-hidden">
                      {formData.venueMapLink || formData.venueName ? (
                        <iframe
                          title="Map Preview"
                          width="100%"
                          height="100%"
                          style={{ border: 0 }}
                          loading="lazy"
                          allowFullScreen
                          src={`https://maps.google.com/maps?q=${encodeURIComponent(formData.venueName || (formData.venueMapLink.includes('goo.gl') ? '' : formData.venueMapLink))}&output=embed`}
                        ></iframe>
                      ) : (
                        <div className="text-center p-4">
                          <MapPin size={32} className="text-slate-300 mx-auto mb-2" />
                          <p className="text-xs text-slate-400">Map preview will appear here</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* 4. Multimedia Uploads (Cloudinary) */}
                <section>
                  <h3 className="text-lg font-semibold border-b pb-2 mb-4 flex items-center gap-2"><UploadCloud size={20} className="text-blue-500" /> Cloudinary Media</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Thumbnail Upload */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-slate-700">SEO Thumbnail (PNG/JPEG)</label>
                        <div className="flex items-center gap-1.5">
                          <input 
                            type="checkbox" 
                            id="autoThumb" 
                            // @ts-ignore
                            checked={formData.autoGenerateThumbnail} 
                            onChange={(e) => setFormData(prev => ({ ...prev, autoGenerateThumbnail: e.target.checked }))}
                            className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300"
                          />
                          <label htmlFor="autoThumb" className="text-[10px] text-slate-500 font-bold uppercase cursor-pointer">Auto-Design</label>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <input type="text" value={formData.thumbnailUrl} readOnly placeholder="Upload or paste URL..." className="flex-1 p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs" />
                        <button type="button" onClick={() => thumbInputRef.current?.click()} className="bg-blue-600 text-white p-2.5 rounded-lg hover:bg-blue-700">
                          {isUploading === 'thumbnail' ? <Loader2 className="animate-spin" size={18} /> : <UploadCloud size={18} />}
                        </button>
                      </div>
                      <input type="file" ref={thumbInputRef} hidden accept="image/*" onChange={(e) => uploadToCloudinary(e.target.files, 'thumbnail')} />
                    </div>

                    {/* Invitation Video Upload */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Invitation Video (MP4)</label>
                      <div className="flex gap-2">
                        <input type="text" value={formData.invitationVideoUrl} readOnly placeholder="Upload or paste URL..." className="flex-1 p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs" />
                        <button type="button" onClick={() => videoInputRef.current?.click()} className="bg-indigo-600 text-white p-2.5 rounded-lg hover:bg-indigo-700">
                          {isUploading === 'video' ? <Loader2 className="animate-spin" size={18} /> : <Film size={18} />}
                        </button>
                      </div>
                      <input type="file" ref={videoInputRef} hidden accept="video/*" onChange={(e) => uploadToCloudinary(e.target.files, 'video')} />
                    </div>

                    {/* Gallery Upload */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Photo Gallery (Bulk Upload)</label>
                      <textarea name="galleryUrls" value={formData.galleryUrls} onChange={handleInputChange} rows={3} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs mb-2" placeholder="URLs will appear here after upload..." />
                      <button type="button" onClick={() => galleryInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 text-sm font-semibold">
                        {isUploading === 'gallery' ? <Loader2 className="animate-spin" size={18} /> : <ImageIcon size={18} />}
                        Select Multiple Gallery Photos
                      </button>
                      <input type="file" ref={galleryInputRef} hidden multiple accept="image/*" onChange={(e) => uploadToCloudinary(e.target.files, 'gallery')} />
                    </div>

                    {/* Auto-Thumbnail Design Selection */}
                    {/* @ts-ignore */}
                    {formData.autoGenerateThumbnail && (
                      <div className="md:col-span-2 bg-blue-50/50 p-4 rounded-xl border border-blue-100 mt-2">
                        <label className="block text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
                          <ImageIcon size={16} /> Choose Your Base Design
                        </label>
                        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                          {baseDesigns.map((design) => (
                            <button
                              key={design.id}
                              type="button"
                              onClick={() => setSelectedBaseDesign(design.id)}
                              className={`flex-shrink-0 w-32 group relative rounded-lg overflow-hidden border-2 transition-all ${
                                selectedBaseDesign === design.id ? 'border-blue-500 ring-2 ring-blue-200 scale-105' : 'border-slate-200'
                              }`}
                            >
                              <img 
                                src={`https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload/w_200,h_120,c_fill,f_auto,q_auto/${design.id}.png`} 
                                alt={design.name}
                                className="w-full h-20 object-cover"
                              />
                              <div className={`absolute bottom-0 inset-x-0 p-1 text-[8px] font-bold text-center uppercase ${
                                selectedBaseDesign === design.id ? 'bg-blue-500 text-white' : 'bg-black/60 text-white'
                              }`}>
                                {design.name}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* 5. YouTube Settings */}
                <section>
                  <h3 className="text-lg font-semibold border-b pb-2 mb-4 flex items-center gap-2"><Play size={20} className="text-red-500" /> YouTube Stream Settings</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">YouTube Privacy Status</label>
                      <div className="flex gap-4">
                        {['public', 'unlisted'].map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setFormData(prev => ({ ...prev, youtubePrivacy: p }))}
                            className={`flex-1 py-2 px-4 rounded-lg border transition-all ${
                              formData.youtubePrivacy === p 
                              ? 'bg-red-50 border-red-500 text-red-600' 
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-400'
                            }`}
                          >
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center text-xs text-slate-500 italic pt-6">
                      Note: A new Stream Key will be created with the Event Title and linked automatically.
                    </div>
                  </div>
                </section>

                {/* 6. Photographer & Submit */}
                <section>
                  <h3 className="text-lg font-semibold border-b pb-2 mb-4 flex items-center gap-2"><Users size={20} className="text-blue-500" /> Credits</h3>
                  <div className="relative">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Search Photographer</label>
                    <div className="relative">
                      <input type="text" placeholder="Search..." value={selectedPhotographer ? selectedPhotographer.name : photographerSearchQuery} onChange={(e) => { setPhotographerSearchQuery(e.target.value); setSelectedPhotographer(null); setShowPhotographerList(true); }} onFocus={() => setShowPhotographerList(true)} className="w-full p-2.5 pl-10 bg-slate-50 border border-slate-200 rounded-lg" />
                      <Search className="absolute left-3 top-3 text-slate-400" size={18} />
                    </div>
                    {showPhotographerList && photographerSearchQuery && !selectedPhotographer && (
                      <div className="absolute z-20 w-full mt-1 bg-white border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                        {filteredPhotographers.map(p => (
                          <button key={p.id} type="button" onClick={() => { setSelectedPhotographer(p); setShowPhotographerList(false); }} className="w-full p-3 hover:bg-blue-50 text-left border-b text-sm">
                            <p className="font-bold">{p.name}</p>
                            <p className="text-xs text-slate-500">{p.city} • {p.phone_number}</p>
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedPhotographer && (
                        <div>
                          <p className="text-[10px] font-bold text-green-700 uppercase tracking-widest mb-0.5">Selected Credits</p>
                          <p className="font-bold text-slate-800 text-lg leading-tight">{selectedPhotographer.name}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <p className="text-sm text-slate-500">{selectedPhotographer.city} • {selectedPhotographer.phone_number}</p>
                            {selectedPhotographer.instagram_url && (
                              <a href={selectedPhotographer.instagram_url} target="_blank" className="text-blue-600 hover:text-blue-700 transition-colors">
                                <Link size={16} />
                              </a>
                            )}
                          </div>
                        </div>
                    )}
                  </div>
                </section>

                {/* SEO & Social Preview Section */}
                <section className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                  <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                    <Search size={16} className="text-blue-500" /> WhatsApp / Social Share Preview
                  </h3>
                  
                  <div className="max-w-[350px] mx-auto bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
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
                    <div className="p-3 bg-[#f0f2f5]">
                      <h4 className="text-[13px] font-bold text-slate-800 truncate">
                        {formData.groomName || formData.celebrantName || "Couple Names"} & {formData.brideName || "Family"} {formData.eventType} | {formData.eventDate || "Date"}
                      </h4>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                        Join us live for the {formData.eventType} of {formData.groomName || formData.celebrantName || "Name"} & {formData.brideName || "Family"}. Venue: {formData.venueName || "Location Name"}.
                      </p>
                      <div className="text-[9px] text-slate-400 mt-2 font-mono">https://eventcast.pro/events/...</div>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center mt-3 italic">
                    * This is how the link will look when shared on WhatsApp, Facebook, or Instagram.
                  </p>
                </section>

                <div className="pt-6">
                  <button type="submit" disabled={isSubmitting || !!isUploading} className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg shadow-lg disabled:bg-slate-400">
                    {isSubmitting ? (isEditing ? "Updating..." : "Creating...") : (isEditing ? "Update Automated Event" : "Create Automated Event")}
                  </button>
                  {isEditing && (
                    <button type="button" onClick={() => { setIsEditing(false); setEditingId(null); setFormData({
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
                      }); setSelectedPhotographer(null); }} className="w-full mt-2 py-2 text-slate-500 font-medium hover:text-slate-800 transition-colors">
                      Cancel Editing
                    </button>
                  )}
                </div>

              </form>
            </div>
          </div>
        )}
        {activeTab === "help" && (
          <div className="max-w-4xl mx-auto space-y-8 bg-white p-10 rounded-3xl border border-slate-200 shadow-sm">
             <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3">
               <Video size={32} className="text-blue-600" /> User Manual & Help Center
             </h2>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                <div className="space-y-4">
                   <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                     <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">1</div>
                     Creating an Event
                   </h3>
                   <p className="text-slate-600 text-sm leading-relaxed">
                     To create a new event, fill in the names, date, and venue. Paste a Google Maps link to auto-fill the venue name. Upload a high-quality thumbnail (16:9) for YouTube and Social sharing.
                   </p>
                </div>
                <div className="space-y-4">
                   <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                     <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">2</div>
                     YouTube Automation
                   </h3>
                   <p className="text-slate-600 text-sm leading-relaxed">
                     The system automatically schedules a YouTube Live broadcast. Copy the **Stream Key** from the dashboard and paste it into OBS or VMix to start streaming.
                   </p>
                </div>
                <div className="space-y-4">
                   <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                     <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">3</div>
                     Website Generation
                   </h3>
                   <p className="text-slate-600 text-sm leading-relaxed">
                     After clicking 'Create', the system pushes code to GitHub. Your website will be live at `eventcast.pro/events/[slug]` within seconds.
                   </p>
                </div>
                <div className="space-y-4">
                   <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                     <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">4</div>
                     Wishes Moderation
                   </h3>
                   <p className="text-slate-600 text-sm leading-relaxed">
                     Go to the **Moderation** tab to see messages from guests. You can delete inappropriate messages to keep the Wishes Wall clean.
                   </p>
                </div>
             </div>
             <div className="mt-12 p-6 bg-slate-50 rounded-2xl border border-slate-100">
                <h4 className="font-bold text-slate-800 mb-2">Need Technical Support?</h4>
                <p className="text-sm text-slate-500">Contact Renugopal or the Antigravity AI team for system updates or troubleshooting.</p>
             </div>
          </div>
        )}
      </main>

      {/* Asset Preview Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/95 backdrop-blur-md animate-in fade-in duration-300">
          <button 
            onClick={() => setSelectedAsset(null)}
            className="absolute top-6 right-6 p-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition-all border border-white/20"
          >
            <X size={28} />
          </button>
          
          <div className="max-w-5xl w-full max-h-[85vh] flex items-center justify-center">
            {selectedAsset.toLowerCase().endsWith('.mp4') || selectedAsset.toLowerCase().endsWith('.mov') || selectedAsset.includes('/video/upload/') ? (
              <video 
                src={selectedAsset} 
                controls 
                autoPlay 
                className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl shadow-black/50"
              />
            ) : (
              <img 
                src={selectedAsset} 
                alt="Preview" 
                className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl shadow-black/50 object-contain"
              />
            )}
          </div>
          
          <div className="absolute bottom-10 flex flex-col items-center gap-4">
            <code className="bg-white/10 px-4 py-2 rounded-lg text-white/80 text-xs font-mono border border-white/10">
              {selectedAsset}
            </code>
            <button 
              onClick={() => { navigator.clipboard.writeText(selectedAsset); alert("URL Copied!"); }}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-xl"
            >
              <Link size={20} /> Copy Asset URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
