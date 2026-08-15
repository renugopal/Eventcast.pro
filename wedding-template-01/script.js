// --- CONFIG DRIVEN LOGIC ---
// These values should be provided by config.js
function parseTimerTarget(value) {
    if (!value) return NaN;
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) return direct.getTime();
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return NaN;
    const [, date, hh, mm, ss] = match;
    return new Date(`${date}T${hh.padStart(2, '0')}:${mm}:${ss || '00'}`).getTime();
}

const CONFIG = window.WEDDING_CONFIG || {
    groom: "Sample",
    bride: "Event",
    date: "Saturday, January 1st",
    time: "09:00 AM",
    timeSubtext: "",
    timerTarget: new Date().toISOString(),
    venue: "Venue Name",
    venueSubtext: "",
    youtubeId: "",
    restreamerUrl: "",
    restreamerPlayer: "",
    invitationVideo: "",
    thumbnail: "assets/gallery_1.png",
    gallery: ["assets/gallery_1.png", "assets/gallery_2.png", "assets/gallery_3.png"],
    supabaseUrl: '',
    supabaseKey: '',
    eventId: '',
    eventType: 'Wedding',
    introText: '',
    photographer: null
};

const WEDDING_DATE = parseTimerTarget(CONFIG.timerTarget);

function isHlsStreamUrl(url) {
    if (!url) return false;
    if (/youtube\.com|youtu\.be/i.test(url)) return false;
    return /\.m3u8(\?|$)/i.test(url) || /\/hls\//i.test(url) || /\.mp4(\?|$)/i.test(url);
}

// --- SUPABASE WISHES LOGIC ---
const _supabase = (CONFIG.supabaseUrl && CONFIG.supabaseKey)
    ? supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey)
    : null;

// --- PRIVACY-SAFE VISITOR IDENTITY (Analytics + Audience delivery package) ---
// One opaque, browser-generated random identifier, persisted in
// localStorage so repeat visits from the same browser can be recognized as
// the same "unique visitor". Never derived from IP, user-agent
// fingerprinting, or any advertising identifier. If localStorage is
// unavailable (privacy mode, storage blocked), a fresh id is generated per
// page load instead of failing — that visit still counts as a page view,
// it just can't be recognized as a repeat visitor.
//
// Always UUID-shaped: the audience-heartbeat RPC takes uuid parameters, so
// a structurally invalid identifier is rejected by the database's type
// system before it can reach any table.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function randomUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

function getOrCreateVisitorId() {
    const STORAGE_KEY = 'ec_visitor_id';
    try {
        let id = window.localStorage.getItem(STORAGE_KEY);
        if (!id || !UUID_PATTERN.test(id)) {
            id = randomUuid();
            window.localStorage.setItem(STORAGE_KEY, id);
        }
        return id;
    } catch {
        return randomUuid();
    }
}
const VISITOR_ID = getOrCreateVisitorId();

// --- CLOUDINARY OPTIMIZATION ---
const optimizeUrl = (url) => {
    if (!url || !url.includes('cloudinary.com')) return url;
    
    // 1. Skip optimization for videos (saves massive credits)
    if (url.includes('/video/upload/')) return url;
    
    // 2. Prevent double-tagging if f_auto,q_auto already exists
    if (url.includes('f_auto,q_auto')) return url;

    // 3. Apply optimization only for images
    if (url.includes('/upload/')) {
        return url.replace('/upload/', '/upload/f_auto,q_auto,w_1920,c_limit/');
    }
    return url;
};

// --- CHROMECAST SENDER INTEGRATION ---
let castSession = null;
window.isCastApiAvailable = false;

window['__onGCastApiAvailable'] = function(isLoaded) {
    if (isLoaded && typeof cast !== 'undefined') {
        try {
            cast.framework.CastContext.getInstance().setOptions({
                receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
            });

            // Register session state listeners
            const context = cast.framework.CastContext.getInstance();
            context.addEventListener(
                cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                function(event) {
                    switch (event.sessionState) {
                        case cast.framework.SessionState.SESSION_STARTED:
                        case cast.framework.SessionState.SESSION_RESUMED:
                            console.log("Cast Session established!");
                            castSession = event.session;
                            onCastSessionStarted(castSession);
                            break;
                        case cast.framework.SessionState.SESSION_ENDED:
                            console.log("Cast Session disconnected.");
                            castSession = null;
                            onCastSessionEnded();
                            break;
                    }
                }
            );

            window.isCastApiAvailable = true;

            // Reveal the container once initialized so the button is rendered when active
            const castContainer = document.querySelector('.cast-button-container');
            if (castContainer) {
                castContainer.style.display = 'block';
            }
        } catch (e) {
            console.error("Cast SDK init failed:", e);
        }
    }
};

function onCastSessionStarted(session) {
    if (!session || !CONFIG.restreamerUrl) return;

    // Setup media info for HLS streaming (.m3u8)
    const mediaInfo = new chrome.cast.media.MediaInfo(CONFIG.restreamerUrl, 'application/x-mpegurl');
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.metadataType = chrome.cast.media.MetadataType.GENERIC;

    // Set beautiful metadata matching the active event details
    const celebrant = CONFIG.groom && CONFIG.bride && CONFIG.bride.toLowerCase() !== 'family'
        ? `${CONFIG.groom} & ${CONFIG.bride}`
        : CONFIG.groom || 'Eventcast Broadcast';
    mediaInfo.metadata.title = `${celebrant} - Live Wedding`;
    mediaInfo.metadata.subtitle = CONFIG.venue || "Watch on Smart TV";

    if (CONFIG.thumbnail) {
        mediaInfo.metadata.images = [{ url: CONFIG.thumbnail }];
    }

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    session.loadMedia(request).then(
        function() {
            console.log("Stream successfully casted to TV!");
            
            // Safely pause local playback
            const video = document.getElementById('hls-video');
            if (video) video.pause();
            if (window.plyrPlayer && typeof window.plyrPlayer.pause === 'function') {
                window.plyrPlayer.pause();
            }
        },
        function(err) {
            console.error("Failed to load stream on Chromecast:", err);
        }
    );
}

function onCastSessionEnded() {
    // Gracefully handle session disconnection
    const video = document.getElementById('hls-video');
    if (video && video.paused) {
        video.play().catch(e => console.log("Auto-resume prevented:", e));
    }
}

// --- UI INJECTION ---
document.addEventListener('DOMContentLoaded', () => {
    // --- LOADER: Update photo & initials dynamically from CONFIG ---
    const loaderPhoto = document.querySelector('.loader-photo img');
    const loaderPhotoDiv = document.querySelector('.loader-photo');
    if (CONFIG.hideLoaderPhoto) {
        if (loaderPhotoDiv) loaderPhotoDiv.style.display = 'none';
    } else if (loaderPhoto) {
        if (CONFIG.loaderPhotoUrl) {
            loaderPhoto.src = optimizeUrl(CONFIG.loaderPhotoUrl);
            loaderPhoto.onerror = () => { loaderPhoto.style.display = 'none'; };
        } else if (CONFIG.thumbnail) {
            loaderPhoto.src = optimizeUrl(CONFIG.thumbnail);
            loaderPhoto.onerror = () => { loaderPhoto.style.display = 'none'; };
        } else if (CONFIG.gallery && CONFIG.gallery.length > 0) {
            loaderPhoto.src = optimizeUrl(CONFIG.gallery[0]);
            loaderPhoto.onerror = () => { loaderPhoto.style.display = 'none'; };
        } else {
            // No photo available — hide the photo circle
            if (loaderPhotoDiv) loaderPhotoDiv.style.display = 'none';
        }
    }

    // Inject names and titles
    let initials = CONFIG.customInitials;
    if (!initials) {
        const groomInitial = CONFIG.groom ? CONFIG.groom[0].toUpperCase() : '';
        const brideInitial = CONFIG.bride && CONFIG.bride !== 'Family' ? CONFIG.bride[0].toUpperCase() : '';
        initials = groomInitial && brideInitial ? `${groomInitial} & ${brideInitial}` : (groomInitial || brideInitial);
    }
    document.querySelectorAll('.logo-text, .initials').forEach(el => el.innerText = initials);
    
    if (document.querySelector('.first-name')) document.querySelector('.first-name').innerText = CONFIG.groom || CONFIG.bride;
    if (document.querySelector('.second-name')) document.querySelector('.second-name').innerText = CONFIG.bride && CONFIG.groom ? CONFIG.bride : "";

    // Inject Intro Text — split on \n for multi-line display
    const introEl = document.querySelector('.intro-text');
    if (introEl) {
        if (CONFIG.introText) {
            const lines = CONFIG.introText.split('\n');
            introEl.innerHTML = lines.map(line => `<span style="display:block;text-align:center;">${line}</span>`).join('');
        } else {
            const et = (CONFIG.eventType || 'Wedding').toLowerCase();
            if (et.includes('engagement')) introEl.innerText = 'Welcome to the Engagement of';
            else if (et.includes('wedding')) introEl.innerText = 'Welcome to the Wedding of';
            else introEl.innerText = `Welcome to the ${CONFIG.eventType || 'Event'} of`;
        }
    }

    // --- SEO & TITLE UPDATE ---
    const eventDate = CONFIG.eventDate || (CONFIG.timerTarget && CONFIG.timerTarget.split('T')[0]) || '';
    const seo = typeof generateWeddingWebSEO === 'function'
        ? generateWeddingWebSEO({
            groom: CONFIG.groom || '',
            bride: CONFIG.bride,
            eventType: CONFIG.eventType || 'Wedding',
            eventDate,
        })
        : { title: document.title, description: '' };
    document.title = seo.title;
    const updateMeta = (property, content) => {
        const el = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`);
        if (el) el.setAttribute('content', content);
    };
    updateMeta('og:title', seo.title);
    updateMeta('og:description', seo.description);
    updateMeta('description', seo.description);
    if (CONFIG.thumbnail) {
        updateMeta('og:image', CONFIG.thumbnail);
        updateMeta('twitter:image', CONFIG.thumbnail);
    }
    updateMeta('og:url', window.location.href);

    // --- DYNAMIC TITLES ---
    const invTitle = document.getElementById('invitation-title');
    if (invTitle) invTitle.innerText = `${CONFIG.eventType} Invitation`;
    const galTitle = document.getElementById('gallery-title');
    if (galTitle) galTitle.innerText = 'Memories';

    // --- SAVE TO CALENDAR DYNAMIC LINK ---
    const saveCalBtn = document.getElementById('save-calendar-btn');
    if (saveCalBtn) {
        const startMs = parseTimerTarget(CONFIG.timerTarget);
        if (!Number.isNaN(startMs)) {
            const calTitle = encodeURIComponent(`${CONFIG.groom} ${CONFIG.bride ? '& ' + CONFIG.bride : ''} ${CONFIG.eventType}`);
            const calDate = new Date(startMs).toISOString().replace(/-|:|\.\d\d\d/g, "");
            const calEndDate = new Date(startMs + 3600000).toISOString().replace(/-|:|\.\d\d\d/g, "");
            const calDetails = encodeURIComponent(`Join us live and bless the couple: ${window.location.href}`);
            const calLoc = encodeURIComponent(CONFIG.venue);
            saveCalBtn.href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&dates=${calDate}/${calEndDate}&details=${calDetails}&location=${calLoc}`;
        }
    }

    // --- ANALYTICS: Track Page View ---
    const trackPageView = async () => {
        try {
            const userAgent = navigator.userAgent;
            let deviceType = 'Desktop';
            if (/Mobi|Android/i.test(userAgent)) deviceType = 'Mobile';
            else if (/Tablet|iPad/i.test(userAgent)) deviceType = 'Tablet';

            const referrer = document.referrer.includes('whatsapp') ? 'WhatsApp' : 
                             document.referrer.includes('instagram') ? 'Instagram' : 
                             document.referrer.includes('facebook') ? 'Facebook' : 'Direct';

            // 1. Atomically insert this visit into page_views table
            //    (No race condition — each visit = 1 insert)
            if (_supabase) {
                const viewRow = {
                    event_id: CONFIG.eventId,
                    device_type: deviceType,
                    referrer: referrer,
                    user_agent: userAgent,
                    country: CONFIG.country || 'Unknown',
                    visitor_id: VISITOR_ID,
                };
                if (CONFIG.studioId) viewRow.studio_id = CONFIG.studioId;

                await _supabase.from('page_views').insert([viewRow]);

                // 2. Count total visits (public RPC — direct SELECT blocked by RLS for anon)
                let count = null;
                const { data: singleCount, error: singleErr } = await _supabase
                    .rpc('get_public_event_view_count', { p_event_id: CONFIG.eventId });
                if (!singleErr && singleCount !== null && singleCount !== undefined) {
                    count = singleCount;
                } else {
                    const { data: allCounts } = await _supabase.rpc('get_event_view_counts');
                    const row = (allCounts || []).find((r) => r.event_id === CONFIG.eventId);
                    if (row) count = row.view_count;
                }

                // 3. Update UI with accurate count
                const viewsDisplay = document.getElementById('total-views-display');
                if (viewsDisplay && count !== null) {
                    viewsDisplay.innerText = Number(count).toLocaleString();
                }
            }
        } catch (e) { console.error("Analytics error:", e); }
    };
    trackPageView();
    initLiveViewerCount();
    
    // Inject Info
    const infoItems = document.querySelectorAll('.info-text');
    if (infoItems[0]) infoItems[0].innerText = CONFIG.date;
    if (infoItems[1]) infoItems[1].innerText = CONFIG.time;
    if (infoItems[2]) infoItems[2].innerText = CONFIG.venue;
    
    const subtexts = document.querySelectorAll('.info-subtext');
    if (subtexts[0]) subtexts[0].innerText = CONFIG.timeSubtext || '';
    if (subtexts[1]) subtexts[1].innerText = CONFIG.venueSubtext || '';

    // Dynamic Time Label: Wedding/Engagement → Sumuhurtham; other events → event type name
    const heroInfoItems = document.querySelectorAll('.hero-info-item');
    if (heroInfoItems[1]) {
        const lbl = heroInfoItems[1].querySelector('.info-label');
        if (lbl) {
            const et = (CONFIG.eventType || '').toLowerCase();
            const isWeddingOrEngagement = et.includes('wedding') || et.includes('engagement');
            lbl.innerText = CONFIG.timeLabel || (isWeddingOrEngagement ? 'Sumuhurtham' : (CONFIG.eventType || 'Event'));
        }
    }

    // --- Invitation Video Section: Smart Control ---
    const invVideo = document.getElementById('main-invitation-video');
    const videoOverlay = document.getElementById('video-play-overlay');
    const videoWrapper = document.getElementById('video-wrapper');
    const videoDotsContainer = document.getElementById('video-dots');
    const allVideos = (CONFIG.invitationVideos && CONFIG.invitationVideos.length > 0)
        ? CONFIG.invitationVideos
        : (CONFIG.invitationVideo ? [CONFIG.invitationVideo] : []);

    if (allVideos.length > 0 && invVideo) {
        let currentVideoIndex = 0;
        let loopCount = 0;
        const MAX_LOOPS = 3;
        let isLoopingEnabled = true;
        let videoSourceLoaded = false; // true once the browser has been told to fetch any bytes

        invVideo.setAttribute('poster', optimizeUrl(CONFIG.thumbnail));

        function playVideoAt(index) {
            currentVideoIndex = index;
            const src = invVideo.querySelector('source');
            if (src) src.setAttribute('src', optimizeUrl(allVideos[index]));

            // Only call load()/play() after the source has been initialised by the
            // IntersectionObserver or a manual user tap — never on initial page load.
            if (videoSourceLoaded) {
                invVideo.load();
                if (videoOverlay && videoOverlay.style.display === 'none') {
                    invVideo.play().catch(() => {});
                }
            }

            // Update dots
            if (allVideos.length > 1 && videoDotsContainer) {
                videoDotsContainer.querySelectorAll('.vdot').forEach((dot, i) => {
                    dot.style.background = i === index ? 'var(--gold)' : 'rgba(255,255,255,0.3)';
                    dot.style.transform = i === index ? 'scale(1.4)' : 'scale(1)';
                });
            }
        }

        // Handle video end
        invVideo.addEventListener('ended', () => {
            if (allVideos.length === 1) {
                // Single video loop logic
                loopCount++;
                if (loopCount < MAX_LOOPS && isLoopingEnabled) {
                    invVideo.play().catch(() => {});
                } else {
                    stopVideoAndShowOverlay();
                }
            } else {
                // Playlist logic
                const next = (currentVideoIndex + 1) % allVideos.length;
                if (next === 0) loopCount++; // Finished one full cycle
                
                if (loopCount < MAX_LOOPS && isLoopingEnabled) {
                    playVideoAt(next);
                } else {
                    stopVideoAndShowOverlay();
                }
            }
        });

        function stopVideoAndShowOverlay() {
            isLoopingEnabled = false;
            if (videoOverlay) videoOverlay.style.display = 'flex';
            invVideo.pause();
        }

        function startVideoManually() {
            isLoopingEnabled = true;
            loopCount = 0;
            if (videoOverlay) videoOverlay.style.display = 'none';
            if (!videoSourceLoaded) {
                videoSourceLoaded = true;
                const src = invVideo.querySelector('source');
                if (src) src.setAttribute('src', optimizeUrl(allVideos[currentVideoIndex]));
                invVideo.load();
            }
            invVideo.play().catch(() => {});
        }

        if (videoOverlay) {
            videoOverlay.style.display = 'flex';
            videoOverlay.addEventListener('click', startVideoManually);
        }

        function primeInvitationSource() {
            if (videoSourceLoaded) return;
            videoSourceLoaded = true;
            const src = invVideo.querySelector('source');
            if (src) src.setAttribute('src', optimizeUrl(allVideos[currentVideoIndex]));
            invVideo.load();
        }

        function tryAutoplayInvitation() {
            if (!isLoopingEnabled) return;
            primeInvitationSource();
            invVideo.play()
                .then(() => { if (videoOverlay) videoOverlay.style.display = 'none'; })
                .catch(() => { if (videoOverlay) videoOverlay.style.display = 'flex'; });
        }

        // --- Intersection Observer: Lazy-load + play only when visible ---
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && isLoopingEnabled) {
                    tryAutoplayInvitation();
                } else {
                    invVideo.pause();
                }
            });
        }, { threshold: 0.2 });

        if (videoWrapper) observer.observe(videoWrapper);

        // Layout settles after loader — prime if section is already on screen
        window.addEventListener('load', () => {
            if (!videoWrapper) return;
            const rect = videoWrapper.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) {
                tryAutoplayInvitation();
            }
        });

        // Initial setup
        if (allVideos.length > 1 && videoDotsContainer) {
            videoDotsContainer.style.display = 'flex';
            videoDotsContainer.innerHTML = allVideos.map((_, i) => `
                <span class="vdot" style="width:10px; height:10px; border-radius:50%; display:inline-block; cursor:pointer; transition: all 0.3s; background: rgba(255,255,255,0.3);" onclick="playVideoAt_global(${i})"></span>
            `).join('');
            window.playVideoAt_global = (i) => {
                isLoopingEnabled = true;
                if (videoOverlay) videoOverlay.style.display = 'none';
                playVideoAt(i);
            };
        }

        // currentVideoIndex is already 0. Source is lazy-loaded on first viewport
        // intersection or user tap — no load() call here prevents background download.
    } else if (invVideo) {
        const section = document.getElementById('invitation-video');
        if (section) section.style.display = 'none';
    }


    // --- Photo Gallery: hide section if no photos provided, else inject ---
    const photoSection = document.getElementById('photo-gallery');
    const slideshowWrapper = document.querySelector('.slideshow-wrapper');
    const dotsContainer = document.querySelector('.ss-dots');
    
    // Update gallery section title
    const galleryTitle = document.querySelector('#photo-gallery .section-title');
    if (galleryTitle) galleryTitle.innerText = 'Memories';

    if (CONFIG.gallery && CONFIG.gallery.length > 0) {
        if (slideshowWrapper) {
            slideshowWrapper.innerHTML = CONFIG.gallery.map((url, i) => `
                <div class="slide ${i === 0 ? 'active' : ''}">
                    <div class="slide-bg" style="background-image: url('${optimizeUrl(url)}');"></div>
                    <img src="${optimizeUrl(url)}" alt="Memory ${i+1}" class="gallery-img">
                </div>
            `).join('');
        }
        
        if (dotsContainer) {
            dotsContainer.innerHTML = CONFIG.gallery.map((_, i) => `
                <span class="dot ${i === 0 ? 'active' : ''}"></span>
            `).join('');
        }
    } else {
        // No photos → hide the entire gallery section
        if (photoSection) photoSection.style.display = 'none';
    }

    // Photographer Credit
    const logo = document.getElementById('footer-logo');
    const name = document.getElementById('footer-studio-name');
    const phone = document.getElementById('footer-phone');
    const insta = document.getElementById('footer-insta');

    if (CONFIG.photographer) {
        if (logo && CONFIG.photographer.logo_url) {
            logo.src = optimizeUrl(CONFIG.photographer.logo_url);
            logo.style.display = 'block';
        } else if (logo) logo.style.display = 'none';

        const studioLabel =
          CONFIG.photographer.studio_name ||
          CONFIG.photographer.name ||
          CONFIG.photographer.nickname ||
          '';
        if (name) {
          if (studioLabel) {
            name.innerText = studioLabel;
            name.style.display = 'block';
          } else {
            name.style.display = 'none';
          }
        }

        if (phone && CONFIG.photographer.phone_number) {
            phone.href = `tel:${CONFIG.photographer.phone_number.replace(/\s+/g, '')}`;
            phone.querySelector('span').innerText = CONFIG.photographer.phone_number;
            phone.style.display = 'block';
        } else if (phone) phone.style.display = 'none';

        if (insta) insta.style.display = 'none';
    } else {
        // Hide all photographer specific elements but keep footer/stats
        if (logo) logo.style.display = 'none';
        if (name) name.style.display = 'none';
        if (phone) phone.style.display = 'none';
        if (insta) insta.style.display = 'none';
    }
});

// --- LOADER ---
window.addEventListener('load', () => {
    const loader = document.getElementById('loader');
    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
        }, 500);
    }, 1200);

    initGpuOptimizations();
    startPetals();
    initScrollReveal();
    initSlideshow();
});

// --- SLIDESHOW LOGIC ---
function initSlideshow() {
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    const prev = document.querySelector('.ss-prev');
    const next = document.querySelector('.ss-next');
    if (!slides.length) return;
    
    let currentSlide = 0;
    let slideInterval;

    function showSlide(n) {
        slides[currentSlide].classList.remove('active');
        dots[currentSlide].classList.remove('active');
        currentSlide = (n + slides.length) % slides.length;
        slides[currentSlide].classList.add('active');
        dots[currentSlide].classList.add('active');
    }

    function nextSlide() {
        showSlide(currentSlide + 1);
    }

    function startSlideshow() {
        slideInterval = setInterval(nextSlide, 5000);
    }

    function resetSlideshow() {
        clearInterval(slideInterval);
        startSlideshow();
    }

    prev?.addEventListener('click', () => {
        showSlide(currentSlide - 1);
        resetSlideshow();
    });

    next?.addEventListener('click', () => {
        showSlide(currentSlide + 1);
        resetSlideshow();
    });

    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            showSlide(index);
            resetSlideshow();
        });
    });

    startSlideshow();
}

// --- VIDEO PLAYER LOGIC ---
var ytScriptTag = document.createElement('script');
ytScriptTag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(ytScriptTag, firstScriptTag);

let player;
function onYouTubeIframeAPIReady() {
    const livestreamSection = document.getElementById('livestream');
    const playerContainer = document.getElementById('youtube-player');
    const statusBadge = document.querySelector('.status-badge');

    if (!CONFIG.youtubeId && !isHlsStreamUrl(CONFIG.restreamerPlayer)) {
        if (livestreamSection) livestreamSection.style.display = 'none';
        return;
    }

    // 1. Native HLS/MP4 player only for Restreamer or archived file URLs
    if (isHlsStreamUrl(CONFIG.restreamerUrl)) {
        console.log("Using Native HLS Player for Restreamer...");
        if (playerContainer) {
            playerContainer.innerHTML = `
                <div class="plyr-container" style="position:absolute; top:0; left:0; width:100%; height:100%; overflow:hidden; background:#000;">
                    <video id="hls-video" controls width="100%" height="100%" playsinline style="width:100%; height:100%; object-fit:contain;"></video>
                    
                    <!-- Floating Glassmorphic Chromecast Button -->
                    <div class="cast-button-container" style="position:absolute; top:15px; right:15px; z-index:15; display:none;">
                        <google-cast-launcher id="chromecast-btn"></google-cast-launcher>
                    </div>

                    <div id="hls-loader" class="hls-loader-container" style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:10; background:rgba(0,0,0,0.5);">
                        <i class="fas fa-spinner fa-spin" style="font-size:3rem; margin-bottom:15px; color:white;"></i>
                        <p style="font-family:'Playfair Display', serif; letter-spacing:2px; text-transform:uppercase; color:white;">Waiting for Stream to Start...</p>
                    </div>
                </div>
            `;
            
            // Add an attractive YouTube Link button below if available
            if (CONFIG.youtubeId) {
                const ytLink = document.createElement('div');
                ytLink.style.textAlign = 'center';
                ytLink.innerHTML = `
                    <a href="https://youtube.com/watch?v=${CONFIG.youtubeId}" target="_blank" class="btn primary-btn youtube-fallback-btn" style="display:inline-flex; align-items:center; justify-content:center; gap:10px; margin-top:25px; background: linear-gradient(135deg, #e52d27 0%, #b31217 100%); color: white; border: none; min-width: 200px;">
                        <i class="fab fa-youtube" style="font-size:1.3rem;"></i> Watch on YouTube
                    </a>
                `;
                livestreamSection.appendChild(ytLink);
            }

            // Inject Plyr container CSS overrides programmatically to fix any stale CSS cache on already generated pages
            const style = document.createElement('style');
            style.innerHTML = `
                .plyr {
                    height: 100% !important;
                    width: 100% !important;
                }
                .plyr__video-wrapper {
                    height: 100% !important;
                    width: 100% !important;
                }
                .plyr--video {
                    background: #000 !important;
                }
            `;
            document.head.appendChild(style);

            // If the Cast API is already initialized, reveal the floating launcher container
            if (window.isCastApiAvailable) {
                const castContainer = document.querySelector('.cast-button-container');
                if (castContainer) {
                    castContainer.style.display = 'block';
                }
            }

            // Initialize elements and state variables
            const video = document.getElementById('hls-video');
            const loader = document.getElementById('hls-loader');
            const loaderText = loader ? loader.querySelector('p') : null;
            bindGpuSaveForVideo(video);
            let isPlaying = false;
            let hls = null;
            let player = null;
            let pollInterval = null;

            // Update status badge if stream is live
            const updateStatus = (isLive) => {
                if (statusBadge) {
                    if (isLive) {
                        statusBadge.innerHTML = '● LIVE NOW';
                        statusBadge.classList.add('live-glow');
                    } else {
                        statusBadge.innerHTML = '● LIVE SOON';
                        statusBadge.classList.remove('live-glow');
                    }
                }
            };

            const showLoader = (text) => {
                if (loader) {
                    loader.style.display = 'flex';
                    if (loaderText && text) loaderText.innerText = text;
                }
            };

            const hideLoader = () => {
                if (loader) loader.style.display = 'none';
            };

            const destroyHls = () => {
                if (video && video._liveEdgeHandlers) {
                    const h = video._liveEdgeHandlers;
                    video.removeEventListener('play', h.onPlay);
                    video.removeEventListener('pause', h.onPause);
                    document.removeEventListener('visibilitychange', h.onVisibility);
                    delete video._liveEdgeHandlers;
                }
                if (video && video._dropHandlers) {
                    video.removeEventListener('waiting', video._dropHandlers);
                    video.removeEventListener('stalled', video._dropHandlers);
                    video.removeEventListener('ended', video._dropHandlers);
                    delete video._dropHandlers;
                }
                if (player) {
                    player.destroy();
                    player = null;
                }
                if (hls) {
                    hls.destroy();
                    hls = null;
                }
                isPlaying = false;
                stopHeartbeat();
                heartbeatSessionId = null;
            };

            // --- AUDIENCE HEARTBEAT (EventCast private-stream player only) ---
            // Emits a heartbeat only while this EventCast HLS <video> element
            // is genuinely in the 'playing' state — never merely because the page
            // is open (that is the separate, weaker page-presence widget below),
            // and never for YouTube playback (YouTube renders through a different
            // iframe player with no access to this code path).
            //
            // The client has no direct INSERT privilege on the heartbeat table:
            // it calls record_event_audience_heartbeat(), which re-checks event
            // eligibility server-side, stamps the bucket from database time, and
            // accepts at most one row per session per 20-second interval. Calling
            // it more often than the interval simply returns false and records
            // nothing, so repeated calls cannot manufacture watch time.
            const HEARTBEAT_INTERVAL_MS = 20000;
            let heartbeatSessionId = null;
            let heartbeatTimer = null;
            let heartbeatFailureCount = 0;

            function reportHeartbeatFailure(reason) {
                // Never interrupts playback, but a total instrumentation outage
                // must not be invisible during troubleshooting. Logs the failure
                // reason only — never the viewer, session, or any credential.
                heartbeatFailureCount += 1;
                if (heartbeatFailureCount === 1 || heartbeatFailureCount % 5 === 0) {
                    console.warn(
                        `EventCast audience heartbeat not recorded (${heartbeatFailureCount} so far):`,
                        reason || 'unknown error'
                    );
                }
            }

            function sendHeartbeat() {
                if (!_supabase || !CONFIG.eventId || !heartbeatSessionId) return;
                _supabase.rpc('record_event_audience_heartbeat', {
                    p_event_id: CONFIG.eventId,
                    p_viewer_id: VISITOR_ID,
                    p_session_id: heartbeatSessionId,
                }).then(({ data, error }) => {
                    if (error) reportHeartbeatFailure(error.message);
                    // false = server declined: the event is no longer eligible
                    // (unpublished/archived/assignment disabled) or this session
                    // was already counted for this interval. Expected
                    // occasionally; a sustained run of them is a real outage.
                    else if (data === false) reportHeartbeatFailure('declined by server (event ineligible, or already counted for this interval)');
                    else heartbeatFailureCount = 0;
                }, (err) => {
                    // Transport-level failure (offline, blocked request).
                    reportHeartbeatFailure(err && err.message);
                });
            }

            function startHeartbeat() {
                if (heartbeatTimer) return;
                sendHeartbeat();
                heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
            }

            function stopHeartbeat() {
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
            }

            const bindAudienceHeartbeat = () => {
                if (!video || video._audienceHeartbeatBound) return;
                video.addEventListener('playing', startHeartbeat);
                video.addEventListener('pause', stopHeartbeat);
                video.addEventListener('ended', stopHeartbeat);
                video.addEventListener('waiting', stopHeartbeat);
                video._audienceHeartbeatBound = true;
            };
            bindAudienceHeartbeat();

            const seekToLiveEdge = () => {
                if (!video) return;
                try {
                    if (hls && typeof hls.liveSyncPosition === 'number' && isFinite(hls.liveSyncPosition)) {
                        video.currentTime = hls.liveSyncPosition;
                        return;
                    }
                    if (video.seekable && video.seekable.length > 0) {
                        const end = video.seekable.end(video.seekable.length - 1);
                        if (isFinite(end) && end > 0) {
                            video.currentTime = Math.max(0, end - 2);
                        }
                    }
                } catch (_) { /* ignore seek errors during buffer transitions */ }
            };

            const bindLiveEdgeOnResume = () => {
                if (!video || video._liveEdgeHandlers) return;
                let userPaused = false;
                const onPause = () => { userPaused = true; };
                const onPlay = () => {
                    if (userPaused) {
                        userPaused = false;
                        seekToLiveEdge();
                    }
                };
                const onVisibility = () => {
                    if (document.visibilityState === 'visible' && !video.paused) {
                        seekToLiveEdge();
                    }
                };
                video.addEventListener('pause', onPause);
                video.addEventListener('play', onPlay);
                document.addEventListener('visibilitychange', onVisibility);
                video._liveEdgeHandlers = { onPause, onPlay, onVisibility };
            };

            // Restreamer publishes a master playlist first; media segments appear a few seconds after YouTube.
            const resolveHlsPlaybackUrl = async (baseUrl) => {
                const res = await fetch(baseUrl, { cache: 'no-store' });
                if (!res.ok) throw new Error('offline');
                let text = await res.text();
                if (!text.includes('#EXTM3U')) throw new Error('invalid');

                let playbackUrl = baseUrl;
                if (text.includes('#EXT-X-STREAM-INF')) {
                    const variantLine = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
                    if (!variantLine) throw new Error('warming');
                    playbackUrl = new URL(variantLine, baseUrl).href;
                    const mediaRes = await fetch(playbackUrl, { cache: 'no-store' });
                    if (!mediaRes.ok) throw new Error('warming');
                    text = await mediaRes.text();
                }

                if (!text.includes('#EXTINF')) throw new Error('warming');
                return playbackUrl;
            };

            const tryLoadStream = () => {
                if (isPlaying) return;

                resolveHlsPlaybackUrl(CONFIG.restreamerUrl)
                    .then((playbackUrl) => {
                            // --- STREAM IS LIVE ---
                            console.log("Stream detected! Initializing player...");
                            hideLoader();
                            isPlaying = true;
                            updateStatus(true);
                            heartbeatSessionId = randomUuid();
                            
                            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                                hls = new Hls({ 
                                    capLevelToPlayerSize: true, 
                                    maxBufferLength: 15,
                                    maxMaxBufferLength: 30,
                                    liveSyncDurationCount: 2,
                                    liveMaxLatencyDurationCount: 6,
                                    backBufferLength: 0,
                                    startPosition: -1,
                                    enableWorker: true,
                                    lowLatencyMode: false
                                });
                                hls.loadSource(playbackUrl);
                                hls.attachMedia(video);
                                bindLiveEdgeOnResume();

                                // Stream status drop checker
                                const checkStreamStatusOnDrop = () => {
                                    if (!isPlaying) return;
                                    resolveHlsPlaybackUrl(CONFIG.restreamerUrl)
                                        .catch(() => {
                                                console.warn("Stream went offline. Reconnecting...");
                                                destroyHls();
                                                showLoader("Stream Interrupted. Reconnecting...");
                                                startPolling();
                                        });
                                };

                                video.addEventListener('waiting', checkStreamStatusOnDrop);
                                video.addEventListener('stalled', checkStreamStatusOnDrop);
                                video.addEventListener('ended', checkStreamStatusOnDrop);
                                video._dropHandlers = checkStreamStatusOnDrop;

                                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                                    if (typeof Plyr !== 'undefined') {
                                        player = new Plyr(video, {
                                            controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
                                            settings: ['quality'],
                                            tooltips: { controls: true, seek: true }
                                        });
                                        window.plyrPlayer = player;
                                    }
                                    video.play().catch(e => console.log("Autoplay prevented:", e));
                                });

                                // Handle Stream Interruption & Disconnection
                                hls.on(Hls.Events.ERROR, function(event, data) {
                                    if (data.fatal) {
                                        switch (data.type) {
                                            case Hls.ErrorTypes.NETWORK_ERROR:
                                                console.warn("Fatal network error (OBS disconnected/VPN switch), attempting recovery polling...");
                                                destroyHls();
                                                showLoader("Stream Interrupted. Reconnecting...");
                                                startPolling();
                                                break;
                                            case Hls.ErrorTypes.MEDIA_ERROR:
                                                console.warn("Fatal media error, attempting to recover...");
                                                hls.recoverMediaError();
                                                break;
                                            default:
                                                console.warn("Fatal error, recreating player...");
                                                destroyHls();
                                                showLoader("Waiting for Stream to Start...");
                                                startPolling();
                                                break;
                                        }
                                    }
                                });
                            } else if (video && video.canPlayType('application/vnd.apple.mpegurl')) {
                                video.src = playbackUrl;
                                bindLiveEdgeOnResume();
                                video.addEventListener('loadedmetadata', function() {
                                    video.play().catch(e => console.log("Autoplay prevented:", e));
                                });
                            }
                    })
                    .catch((err) => {
                        if (err && err.message === 'warming') {
                            showLoader('Stream starting… (HLS warms up a few seconds after YouTube)');
                        }
                        startPolling();
                    });
            };

            const startPolling = () => {
                if (pollInterval) return;
                pollInterval = setTimeout(() => {
                    pollInterval = null;
                    tryLoadStream();
                }, 3000);
            };
            
            tryLoadStream();
        }
        return; 
    }

    // 2. Fallback to standard YouTube Player API
    if (CONFIG.youtubeId) {
        // Build a pre-live overlay so upcoming streams show thumbnail
        // instead of YouTube's default "Video unavailable / Offline" slate.
        const overlay = document.createElement('div');
        overlay.id = 'yt-prelive-overlay';
        const thumbSrc = CONFIG.thumbnail
            || `https://i.ytimg.com/vi/${CONFIG.youtubeId}/maxresdefault.jpg`;
        overlay.innerHTML = `
            <img src="${thumbSrc}" alt="Live Stream Preview"
                 style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;">
            <div style="position:absolute;top:0;left:0;width:100%;height:100%;
                        background:rgba(0,0,0,0.35);display:flex;flex-direction:column;
                        align-items:center;justify-content:center;gap:14px;">
                <a href="https://www.youtube.com/live/${CONFIG.youtubeId}" target="_blank"
                   rel="noopener" aria-label="Watch on YouTube"
                   style="width:72px;height:72px;border-radius:50%;background:rgba(255,0,0,0.85);
                          display:flex;align-items:center;justify-content:center;
                          box-shadow:0 4px 24px rgba(0,0,0,0.5);transition:transform .2s;">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="#fff"><polygon points="9.5,7 9.5,17 17,12"/></svg>
                </a>
                <span style="color:#fff;font-family:'Playfair Display',serif;font-size:clamp(0.85rem,2.5vw,1.1rem);
                             letter-spacing:1.5px;text-shadow:0 2px 8px rgba(0,0,0,0.6);text-align:center;">
                    LIVE SOON
                </span>
            </div>`;
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;cursor:pointer;';
        const videoContainer = playerContainer ? playerContainer.closest('.video-container') : null;
        if (videoContainer) {
            videoContainer.appendChild(overlay);
        }

        player = new YT.Player('youtube-player', {
            height: '100%',
            width: '100%',
            videoId: CONFIG.youtubeId,
            playerVars: {
                'playsinline': 1,
                'rel': 0,
                'modestbranding': 1,
                'origin': window.location.origin
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
    }
}

function removePreliveOverlay() {
    const ov = document.getElementById('yt-prelive-overlay');
    if (ov) ov.remove();
}

function onPlayerReady(event) {
    const state = event.target.getPlayerState();
    // YT.PlayerState: PLAYING=1, BUFFERING=3
    if (state === 1 || state === 3) {
        removePreliveOverlay();
    }
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING) {
        removePreliveOverlay();
        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge) statusBadge.innerHTML = '<span class="pulse"></span> LIVE NOW';
    }
}

function onPlayerError(event) {
    // Keep the overlay visible — YouTube can't play the upcoming stream yet.
    console.log('YT player error (stream likely not live yet):', event.data);
}

// --- COUNTDOWN TIMER ---
function updateCountdown() {
    if (Number.isNaN(WEDDING_DATE)) return;

    const now = new Date().getTime();
    const distance = WEDDING_DATE - now;

    if (distance < 0) {
        document.querySelector('.countdown-wrapper').innerHTML = `<h3 style="color: var(--gold); font-family: 'Cinzel', serif;">The Event is LIVE! 🎉</h3>`;
        const liveBtn = document.getElementById('floating-live-btn');
        if (liveBtn) liveBtn.style.display = 'flex';
        
        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge) statusBadge.innerHTML = `<span class="pulse"></span> LIVE NOW`;
        return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    const dEl = document.getElementById('days');
    const hEl = document.getElementById('hours');
    const mEl = document.getElementById('minutes');
    const sEl = document.getElementById('seconds');

    if (dEl) dEl.innerText = days.toString().padStart(2, '0');
    if (hEl) hEl.innerText = hours.toString().padStart(2, '0');
    if (mEl) mEl.innerText = minutes.toString().padStart(2, '0');
    if (sEl) sEl.innerText = seconds.toString().padStart(2, '0');
}

setInterval(updateCountdown, 1000);
updateCountdown();

// --- SCROLL REVEAL ---
function initScrollReveal() {
    if (typeof ScrollReveal === 'undefined') return;
    const sr = ScrollReveal({
        origin: 'bottom',
        distance: '40px',
        duration: 800,
        delay: 100,
        reset: false,
        viewFactor: 0.1,
        easing: 'cubic-bezier(0.5, 0, 0, 1)'
    });

    sr.reveal('.reveal', { interval: 200 });
    sr.reveal('.invite-header', { delay: 300, distance: '30px', origin: 'bottom' });
    sr.reveal('.hero-wreath', { delay: 500, scale: 0.5, rotate: { z: 45 }, duration: 2500 });
    sr.reveal('.couple-full-names span', { delay: 800, distance: '40px', origin: 'top', interval: 200 });
    sr.reveal('.hero-info-grid', { delay: 1000, distance: '50px', scale: 0.9 });
    sr.reveal('.countdown-wrapper', { scale: 0.8, delay: 1200 });
    sr.reveal('.hero-actions', { delay: 1400, opacity: 0, distance: '20px' });
    sr.reveal('.gallery-item', { interval: 150, scale: 0.85 });
    sr.reveal('.section-title', { origin: 'left', distance: '100px' });
}

// --- GPU SAVE MODE (petals, blur, pulse animations) ---
let _liveSectionVisible = false;

const GpuSave = {
    _reasons: new Set(),
    enable(reason) {
        this._reasons.add(reason);
        this._sync();
    },
    disable(reason) {
        this._reasons.delete(reason);
        this._sync();
    },
    _sync() {
        const on = this._reasons.size > 0;
        document.body.classList.toggle('gpu-save', on);
        if (on) {
            window.petalAnimation?.pause();
        } else if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            window.petalAnimation?.resume();
        }
    }
};

function updateLiveGpuSave() {
    const video = document.getElementById('hls-video');
    if (_liveSectionVisible && video && !video.paused && video.readyState >= 2) {
        GpuSave.enable('live-watch');
    } else {
        GpuSave.disable('live-watch');
    }
}

function bindGpuSaveForVideo(videoEl) {
    if (!videoEl || videoEl._gpuSaveBound) return;
    ['play', 'pause', 'playing', 'waiting', 'loadeddata'].forEach((evt) => {
        videoEl.addEventListener(evt, updateLiveGpuSave);
    });
    videoEl._gpuSaveBound = true;
}

function initGpuOptimizations() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.body.classList.add('gpu-save');
        return;
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            GpuSave.enable('tab-hidden');
        } else {
            GpuSave.disable('tab-hidden');
        }
    });

    const liveSection = document.getElementById('livestream');
    if (liveSection) {
        new IntersectionObserver((entries) => {
            _liveSectionVisible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.15);
            updateLiveGpuSave();
        }, { threshold: [0, 0.15, 0.35] }).observe(liveSection);
    }
}

// --- FALLING PETALS ANIMATION ---
function startPetals() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = document.getElementById('petal-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let petalsArray = [];
    let running = false;
    let rafId = null;
    const petalColors = ['#FADADD', '#FFF0F5', '#FFC0CB', '#E0F2F1'];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    window.addEventListener('resize', resize);
    resize();

    class Petal {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height - canvas.height;
            this.size = Math.random() * 10 + 5;
            this.speedX = Math.random() * 1 - 0.5;
            this.speedY = Math.random() * 1 + 0.5;
            this.color = petalColors[Math.floor(Math.random() * petalColors.length)];
            this.rotation = Math.random() * 360;
            this.rotationSpeed = Math.random() * 2 - 1;
        }
        update() {
            this.y += this.speedY;
            this.x += Math.sin(this.y / 50) * 0.5;
            this.rotation += this.rotationSpeed;
            if (this.y > canvas.height) {
                this.y = -20;
                this.x = Math.random() * canvas.width;
            }
        }
        draw() {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation * Math.PI / 180);
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, this.size, this.size / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    for (let i = 0; i < 50; i++) petalsArray.push(new Petal());

    function animate() {
        if (!running) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        petalsArray.forEach((petal) => {
            petal.update();
            petal.draw();
        });
        rafId = requestAnimationFrame(animate);
    }

    window.petalAnimation = {
        pause() {
            running = false;
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            canvas.style.visibility = 'hidden';
        },
        resume() {
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            if (document.body.classList.contains('gpu-save')) return;
            if (running) return;
            running = true;
            canvas.style.visibility = 'visible';
            animate();
        }
    };

    if (document.body.classList.contains('gpu-save')) {
        canvas.style.visibility = 'hidden';
    } else {
        running = true;
        animate();
    }
}

// --- MULTI VIDEO SWITCHER ---
function switchVideo(index) {
    const allVideos = (CONFIG.invitationVideos && CONFIG.invitationVideos.length > 0)
        ? CONFIG.invitationVideos
        : (CONFIG.invitationVideo ? [CONFIG.invitationVideo] : []);
    const vid = document.getElementById('main-invitation-video');
    if (vid && allVideos[index]) {
        const src = vid.querySelector('source');
        if (src) src.setAttribute('src', allVideos[index]);
        vid.load();
        vid.play().catch(() => {});
    }
    // Update tab highlight
    allVideos.forEach((_, i) => {
        const tab = document.getElementById(`vtab-${i}`);
        if (tab) {
            tab.style.background = i === index ? 'var(--gold)' : 'transparent';
            tab.style.color = i === index ? '#000' : 'var(--gold)';
        }
    });
}

// --- SUPABASE WISHES LOGIC ---
// Moved to top to avoid race condition

const wishesForm = document.getElementById('wishes-form');
const wishesList = document.getElementById('wishes-list');
const nameInput = document.getElementById('wish-name');
const messageInput = document.getElementById('wish-message');

async function fetchWishes() {
    if (!wishesList || !_supabase) return;
    const { data, error } = await _supabase
        .from('wishes')
        .select('*')
        .eq('event_id', CONFIG.eventId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching wishes:', error);
        return;
    }
    renderWishes(data);
}

function renderWishes(wishes) {
    wishesList.innerHTML = '';
    wishes.forEach(wish => {
        const wishItem = document.createElement('div');
        wishItem.className = 'wish-item';
        wishItem.innerHTML = `
            <h4>${escapeHTML(wish.name)}</h4>
            <p>${escapeHTML(wish.message)}</p>
            <small style="opacity: 0.5; font-size: 0.7rem; display: block; text-align: right;">
                ${new Date(wish.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </small>
        `;
        wishesList.appendChild(wishItem);
    });
}

if (wishesForm) {
    wishesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        const message = messageInput.value.trim();
        if (!name || !message || !_supabase) return;

        const btn = wishesForm.querySelector('button');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Sending...';

        const { error } = await _supabase
            .from('wishes')
            .insert([{ name, message, event_id: CONFIG.eventId }]);

        if (error) {
            alert('Error: ' + error.message);
        } else {
            wishesForm.reset();
            btn.innerHTML = 'Thank You! ❤️';
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 2000);
        }
        btn.disabled = false;
    });
}

if (_supabase) {
    _supabase.channel(`public:wishes_${CONFIG.eventId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes' }, payload => {
            fetchWishes();
        }).subscribe();
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

fetchWishes();

// --- LIVE VIEWER COUNT (Supabase Realtime Presence) ---
function initLiveViewerCount() {
    if (!_supabase || !CONFIG.eventId) return;

    // Each tab gets its own unique key so every open window = 1 viewer
    const presenceKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);

    const channel = _supabase.channel(`presence:event:${CONFIG.eventId}`, {
        config: { presence: { key: presenceKey } }
    });

    const badge = document.getElementById('live-viewer-badge');
    const numEl = badge ? badge.querySelector('.lvc-number') : null;

    function updateBadge(count) {
        if (!badge) return;
        // Only show badge when 2+ people are watching (hides on solo preview)
        if (count < 2) {
            badge.style.display = 'none';
        } else {
            badge.style.display = 'inline-flex';
            if (numEl) numEl.textContent = count;
        }
    }

    channel
        .on('presence', { event: 'sync' }, () => {
            const count = Object.keys(channel.presenceState()).length;
            updateBadge(count);
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await channel.track({ joined_at: new Date().toISOString() });
            }
        });

    // Pause presence tracking when tab is hidden (prevents ghost counts)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            channel.untrack();
        } else {
            channel.track({ joined_at: new Date().toISOString() });
        }
    });
}

// --- WHATSAPP SHARE LOGIC ---
document.getElementById('whatsapp-share-btn')?.addEventListener('click', () => {
    const shareData = {
        title: `${CONFIG.groom} ❤️ ${CONFIG.bride} Wedding Invitation`,
        text: `Join us live and be part of our celebration!`,
        url: window.location.href
    };
    if (navigator.share) {
        navigator.share(shareData).catch(err => console.log('Error sharing:', err));
    } else {
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareData.title + "\n" + shareData.url)}`;
        window.open(whatsappUrl, '_blank');
    }
});

// --- HEART SHOWER LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    const heartBtn = document.getElementById('heart-shower-btn');
    
    const spawnHeart = () => {
        const heart = document.createElement('div');
        heart.className = 'floating-heart';
        heart.innerHTML = ['❤️', '💖', '💝', '💕', '💗'][Math.floor(Math.random() * 5)];
        // Randomize position slightly around the button area
        const rightPos = 25 + Math.random() * 30;
        heart.style.right = rightPos + 'px';
        document.body.appendChild(heart);
        setTimeout(() => heart.remove(), 3000);
    };

    if (_supabase && CONFIG.eventId) {
        const interactionChannel = _supabase.channel(`interactions_${CONFIG.eventId}`, {
            config: { broadcast: { self: true } }
        });
        
        interactionChannel
            .on('broadcast', { event: 'heart' }, () => {
                spawnHeart();
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log("Interactions sync active!");
                }
            });

        if (heartBtn) {
            heartBtn.addEventListener('click', () => {
                interactionChannel.send({
                    type: 'broadcast',
                    event: 'heart',
                    payload: {}
                });
            });
        }
    }
});

// ============================================================
// GUEST PHOTO WALL
// Browser-side WebP compression → R2 upload via /api/guest-photos/upload
// Supabase Realtime for live photo grid updates
// ============================================================
(function initGuestPhotoWall() {
    if (!window.WEDDING_CONFIG || !WEDDING_CONFIG.guestPhotoWallEnabled) return;
    if (!WEDDING_CONFIG.eventId) return;

    const section    = document.getElementById('guest-photo-wall');
    const uploadArea = document.getElementById('gpw-upload-area');
    const cameraInput = document.getElementById('gpw-file-camera');
    const galleryInput = document.getElementById('gpw-file-gallery');
    const nameArea   = document.getElementById('gpw-name-area');
    const nameInput  = document.getElementById('gpw-uploader-name');
    const submitBtn  = document.getElementById('gpw-submit-btn');
    const progress   = document.getElementById('gpw-progress');
    const progressTx = document.getElementById('gpw-progress-text');
    const limitMsg   = document.getElementById('gpw-limit-msg');
    const emptyState = document.getElementById('gpw-empty-state');
    const stepsEl    = document.getElementById('gpw-steps');
    const grid       = document.getElementById('gpw-grid');

    if (!section || !grid) return;

    const LIMIT = WEDDING_CONFIG.guestPhotoLimit || 50;
    let selectedFile = null;
    let currentCount = 0;

    function setGpwStep(activeStep) {
        if (!stepsEl) return;
        stepsEl.querySelectorAll('.gpw-step').forEach((el) => {
            const n = parseInt(el.dataset.step, 10);
            el.classList.toggle('gpw-step-active', n === activeStep);
            el.classList.toggle('gpw-step-done', n < activeStep);
        });
    }

    function updateEmptyState() {
        if (!emptyState) return;
        emptyState.classList.toggle('gpw-hidden', currentCount > 0);
    }

    section.style.display = '';
    setGpwStep(1);

    async function loadPhotos() {
        if (!_supabase) return;
        const { data, error } = await _supabase
            .from('guest_photos')
            .select('id, photo_url, uploader_name, created_at')
            .eq('event_id', WEDDING_CONFIG.eventId)
            .eq('approved', true)
            .order('created_at', { ascending: false });
        if (error || !data) return;
        currentCount = data.length;
        grid.innerHTML = '';
        data.forEach(p => addPhotoCard(p, true));
        checkLimit();
        updateEmptyState();
    }

    function addPhotoCard(photo, append) {
        const card = document.createElement('div');
        card.className = 'gpw-photo-card';
        card.dataset.photoId = photo.id;
        card.innerHTML = `
            <img src="${photo.photo_url}" alt="Photo by ${escapeHTML(photo.uploader_name)}" loading="lazy">
            <div class="gpw-name-badge">${escapeHTML(photo.uploader_name)}</div>
        `;
        if (append) grid.appendChild(card);
        else grid.insertBefore(card, grid.firstChild);
        updateEmptyState();
    }

    function checkLimit() {
        if (currentCount >= LIMIT) {
            uploadArea.style.display = 'none';
            nameArea.style.display = 'none';
            limitMsg.style.display = 'block';
        } else {
            uploadArea.style.display = '';
            limitMsg.style.display = 'none';
        }
    }

    function resetUploadFlow() {
        selectedFile = null;
        if (cameraInput) cameraInput.value = '';
        if (galleryInput) galleryInput.value = '';
        nameInput.value = '';
        nameArea.style.display = 'none';
        uploadArea.style.display = '';
        setGpwStep(1);
    }

    function handleFilePick(file) {
        if (!file || !file.type.startsWith('image/')) return;
        selectedFile = file;
        nameArea.style.display = 'block';
        setGpwStep(2);
        nameInput.focus();
    }

    function compressToWebP(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX = 1200;
                    let w = img.width, h = img.height;
                    if (w > MAX || h > MAX) {
                        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                        else       { w = Math.round(w * MAX / h); h = MAX; }
                    }
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    canvas.toBlob(blob => resolve(blob || file), 'image/webp', 0.78);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    cameraInput?.addEventListener('change', (e) => {
        handleFilePick(e.target.files[0]);
    });
    galleryInput?.addEventListener('change', (e) => {
        handleFilePick(e.target.files[0]);
    });

    submitBtn.addEventListener('click', async () => {
        if (!selectedFile) return;
        const name = nameInput.value.trim();
        if (!name) {
            nameInput.style.borderColor = 'rgba(239,68,68,0.6)';
            nameInput.focus();
            setTimeout(() => nameInput.style.borderColor = '', 1500);
            return;
        }
        if (currentCount >= LIMIT) { checkLimit(); return; }

        uploadArea.style.display = 'none';
        nameArea.style.display = 'none';
        progress.style.display = 'block';
        setGpwStep(3);
        if (progressTx) progressTx.textContent = 'Compressing your photo...';
        submitBtn.disabled = true;

        try {
            const compressed = await compressToWebP(selectedFile);
            if (progressTx) progressTx.textContent = 'Uploading...';

            const fd = new FormData();
            fd.append('file', compressed, 'guest-photo.webp');
            fd.append('event_id', WEDDING_CONFIG.eventId);
            fd.append('uploader_name', name);

            const res  = await fetch('/api/guest-photos/upload', { method: 'POST', body: fd });
            const json = await res.json();
            progress.style.display = 'none';

            if (!json.success) {
                if (json.limitReached) { checkLimit(); }
                else {
                    alert('Upload failed: ' + (json.error || 'Unknown error'));
                    uploadArea.style.display = '';
                    nameArea.style.display = 'block';
                    setGpwStep(2);
                }
                submitBtn.disabled = false;
                return;
            }

            resetUploadFlow();
            currentCount++;
            checkLimit();

            const toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(16,185,129,0.9);color:#fff;padding:12px 24px;border-radius:999px;font-size:0.9rem;font-weight:600;z-index:9999;';
            toast.textContent = '\uD83D\uDCF8 Your memory is now live!';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);

        } catch (err) {
            console.error('[GPW]', err);
            progress.style.display = 'none';
            uploadArea.style.display = '';
            nameArea.style.display = 'block';
            setGpwStep(2);
            alert('Something went wrong. Please try again.');
        }
        submitBtn.disabled = false;
    });

    if (_supabase) {
        _supabase.channel(`guest-photos-${WEDDING_CONFIG.eventId}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'guest_photos',
                filter: `event_id=eq.${WEDDING_CONFIG.eventId}`
            }, (payload) => {
                if (payload.new && payload.new.approved) {
                    addPhotoCard(payload.new, false);
                    currentCount++;
                    checkLimit();
                }
            })
            .on('postgres_changes', {
                event: 'DELETE', schema: 'public', table: 'guest_photos',
                filter: `event_id=eq.${WEDDING_CONFIG.eventId}`
            }, (payload) => {
                const card = grid.querySelector(`[data-photo-id="${payload.old.id}"]`);
                if (card) { card.style.opacity = '0'; setTimeout(() => card.remove(), 300); currentCount--; checkLimit(); updateEmptyState(); }
            })
            .subscribe();
    }

    loadPhotos();
})();
