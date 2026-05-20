// --- CONFIG DRIVEN LOGIC ---
const CONFIG = window.WEDDING_CONFIG || {
    groom: "Bhavagna",
    bride: "Naga Sai",
    date: "May 8th 2026",
    time: "09:45 AM",
    timerTarget: "2026-05-08T09:30:00",
    venue: "B Convention Hall",
    youtubeId: "",
    restreamerUrl: "",
    restreamerPlayer: "",
    invitationVideo: "assets/invitation.mp4",
    thumbnail: "assets/thumbnail.png",
    gallery: [],
    supabaseUrl: 'https://ntjqjmuripwexwlhfrny.supabase.co',
    supabaseKey: 'sb_publishable_vi_vz9qfKMJnEymw3WaPpg_2A6SeSWR',
    eventId: 'bhavagna-naga-sai',
    eventType: 'Half Saree Ceremony'
};

const WEDDING_DATE = new Date(CONFIG.timerTarget).getTime();
const EVENT_ID = CONFIG.eventId;
const _supabase = (CONFIG.supabaseUrl && CONFIG.supabaseKey) 
    ? supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey) 
    : null;

// --- UTILS ---
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

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- LOADER ---
window.addEventListener('load', () => {
    const loader = document.getElementById('loader');
    if (loader) {
        setTimeout(() => {
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.style.display = 'none';
            }, 500);
        }, 1200);
    }

    startPetals();
    initScrollReveal();
    initSlideshow();
    initWishes();
});

// --- SLIDESHOW LOGIC ---
function initSlideshow() {
    const slideshowContainer = document.querySelector('.slideshow-container');
    if (!slideshowContainer) return;

    // Use gallery from CONFIG if available
    const gallery = CONFIG.gallery && CONFIG.gallery.length > 0 ? CONFIG.gallery : [CONFIG.thumbnail];
    
    slideshowContainer.innerHTML = gallery.map((url, idx) => `
        <div class="slide ${idx === 0 ? 'active' : ''}">
            <img src="${optimizeUrl(url)}" alt="Gallery ${idx + 1}">
        </div>
    `).join('') + `
        <button class="ss-prev"><i class="fas fa-chevron-left"></i></button>
        <button class="ss-next"><i class="fas fa-chevron-right"></i></button>
        <div class="ss-dots">
            ${gallery.map((_, idx) => `<span class="dot ${idx === 0 ? 'active' : ''}"></span>`).join('')}
        </div>
    `;

    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    const prev = document.querySelector('.ss-prev');
    const next = document.querySelector('.ss-next');
    let currentSlide = 0;
    let slideInterval;

    function showSlide(n) {
        if (!slides.length) return;
        slides[currentSlide].classList.remove('active');
        if (dots.length) dots[currentSlide].classList.remove('active');
        currentSlide = (n + slides.length) % slides.length;
        slides[currentSlide].classList.add('active');
        if (dots.length) dots[currentSlide].classList.add('active');
    }

    function nextSlide() {
        showSlide(currentSlide + 1);
    }

    function startSlideshow() {
        if (slides.length > 1) slideInterval = setInterval(nextSlide, 5000);
    }

    function resetSlideshow() {
        clearInterval(slideInterval);
        startSlideshow();
    }

    if (prev) prev.addEventListener('click', () => { showSlide(currentSlide - 1); resetSlideshow(); });
    if (next) next.addEventListener('click', () => { showSlide(currentSlide + 1); resetSlideshow(); });
    if (dots) dots.forEach((dot, idx) => dot.addEventListener('click', () => { showSlide(idx); resetSlideshow(); }));

    startSlideshow();
}

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
    mediaInfo.metadata.title = `${celebrant} - Live Broadcast`;
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

// --- VIDEO PLAYER LOGIC ---
var ytScriptTag = document.createElement('script');
ytScriptTag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(ytScriptTag, firstScriptTag);

let player;
function onYouTubeIframeAPIReady() {
    const livestreamSection = document.getElementById('live-card');
    const playerContainer = document.getElementById('youtube-player');
    const statusBadge = document.querySelector('.live-badge');

    if (!CONFIG.youtubeId && !CONFIG.restreamerUrl && !CONFIG.restreamerPlayer) {
        const liveSection = document.getElementById('live-card');
        if (liveSection) liveSection.style.display = 'none';
        return;
    }

    // 1. Direct Premium HLS Stream Integration
    if (CONFIG.restreamerUrl) {
        console.log("Using Native HLS Player for Restreamer...");
        if (playerContainer) {
            playerContainer.innerHTML = `
                <div class="plyr-container" style="position:absolute; top:0; left:0; width:100%; height:100%; overflow:hidden; background:#000; border-radius:15px;">
                    <video id="hls-video" controls width="100%" height="100%" playsinline style="width:100%; height:100%; object-fit:contain; border-radius:15px;"></video>
                    
                    <!-- Floating Glassmorphic Chromecast Button -->
                    <div class="cast-button-container" style="position:absolute; top:15px; right:15px; z-index:15; display:none;">
                        <google-cast-launcher id="chromecast-btn"></google-cast-launcher>
                    </div>

                    <div id="hls-loader" class="hls-loader-container" style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:10; background:rgba(0,0,0,0.5); border-radius:15px;">
                        <i class="fas fa-spinner fa-spin" style="font-size:3rem; margin-bottom:15px; color:white;"></i>
                        <p style="font-family:'Playfair Display', serif; letter-spacing:2px; text-transform:uppercase; color:white;">Waiting for Stream to Start...</p>
                    </div>
                </div>
            `;
            
            // Add YouTube Link button if available
            if (CONFIG.youtubeId) {
                const ytLink = document.createElement('div');
                ytLink.style.textAlign = 'center';
                ytLink.style.marginTop = '15px';
                ytLink.innerHTML = `
                    <a href="https://youtube.com/watch?v=${CONFIG.youtubeId}" target="_blank" class="btn outline-btn" style="font-size: 0.7rem; padding: 5px 12px; display: inline-block;">
                        <i class="fab fa-youtube"></i> Watch on YouTube
                    </a>
                `;
                livestreamSection.appendChild(ytLink);
            }

            // Inject Plyr container CSS overrides programmatically
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

            // If Cast API is already initialized, reveal the floating launcher container
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
            let isPlaying = false;
            let hls = null;
            let player = null;
            let pollInterval = null;

            // Update status badge if stream is live
            const updateStatus = (isLive) => {
                if (statusBadge) {
                    if (isLive) {
                        statusBadge.innerHTML = '<span class="pulse"></span> LIVE NOW';
                        statusBadge.classList.add('live-glow');
                    } else {
                        statusBadge.innerHTML = '<span class="pulse"></span> LIVE SOON';
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
            };

            const tryLoadStream = () => {
                if (isPlaying) return;
                
                fetch(CONFIG.restreamerUrl, { method: 'HEAD', cache: 'no-store' })
                    .then(res => {
                        if (res.ok) {
                            console.log("Stream detected! Initializing player...");
                            hideLoader();
                            isPlaying = true;
                            updateStatus(true);
                            
                            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                                hls = new Hls({ 
                                    capLevelToPlayerSize: true, 
                                    maxBufferLength: 30,
                                    maxMaxBufferLength: 60,
                                    liveSyncDurationCount: 3,
                                    liveMaxLatencyDurationCount: 10,
                                    enableWorker: true,
                                    lowLatencyMode: true
                                });
                                hls.loadSource(CONFIG.restreamerUrl);
                                hls.attachMedia(video);

                                const checkStreamStatusOnDrop = () => {
                                    if (!isPlaying) return;
                                    fetch(CONFIG.restreamerUrl, { method: 'HEAD', cache: 'no-store' })
                                        .then(res => {
                                            if (!res.ok) {
                                                console.warn("Stream went offline. Reconnecting...");
                                                destroyHls();
                                                showLoader("Stream Interrupted. Reconnecting...");
                                                startPolling();
                                            }
                                        })
                                        .catch(() => {
                                            console.warn("Stream check failed. Reconnecting...");
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

                                hls.on(Hls.Events.ERROR, function(event, data) {
                                    if (data.fatal) {
                                        switch (data.type) {
                                            case Hls.ErrorTypes.NETWORK_ERROR:
                                                console.warn("Fatal network error, attempting recovery polling...");
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
                                video.src = CONFIG.restreamerUrl;
                                video.addEventListener('loadedmetadata', function() {
                                    video.play().catch(e => console.log("Autoplay prevented:", e));
                                });
                            }
                        } else {
                            startPolling();
                        }
                    })
                    .catch(() => {
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

    // 2. Fallback to Restreamer Iframe (if URL is missing but Iframe source exists)
    if (CONFIG.restreamerPlayer) {
        if (playerContainer) {
            playerContainer.innerHTML = `
                <iframe 
                    src="${CONFIG.restreamerPlayer}&autoplay=true&mute=false&controlbar=true" 
                    width="100%" 
                    height="100%" 
                    style="border:none; min-height: 250px; border-radius: 15px;" 
                    allowfullscreen 
                    allow="autoplay; fullscreen">
                </iframe>
            `;
            if (CONFIG.youtubeId) {
                const ytLink = document.createElement('div');
                ytLink.style.textAlign = 'center';
                ytLink.style.marginTop = '15px';
                ytLink.innerHTML = `
                    <a href="https://youtube.com/watch?v=${CONFIG.youtubeId}" target="_blank" class="btn outline-btn" style="font-size: 0.7rem; padding: 5px 12px; display: inline-block;">
                        <i class="fab fa-youtube"></i> Watch on YouTube
                    </a>
                `;
                livestreamSection.appendChild(ytLink);
            }
        }
        return;
    }

    // 3. Fallback to standard YouTube Player API
    if (CONFIG.youtubeId) {
        player = new YT.Player('youtube-player', {
            height: '100%',
            width: '100%',
            videoId: CONFIG.youtubeId,
            playerVars: {
                'playsinline': 1,
                'rel': 0,
                'modestbranding': 1
            }
        });
    }
}

// --- COUNTDOWN TIMER ---
function updateCountdown() {
    const now = new Date().getTime();
    const distance = WEDDING_DATE - now;
    const wrapper = document.querySelector('.countdown-glass');
    if (!wrapper) return;

    if (distance < 0) {
        wrapper.innerHTML = `<h3 style="color: var(--gold); font-family: 'Cinzel', serif; text-align: center; width: 100%;">The Ceremony is LIVE! 🎉</h3>`;
        return;
    }

    const d = Math.floor(distance / (1000 * 60 * 60 * 24));
    const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((distance % (1000 * 60)) / 1000);

    const dEl = document.getElementById('days');
    const hEl = document.getElementById('hours');
    const mEl = document.getElementById('minutes');
    const sEl = document.getElementById('seconds');

    if (dEl) dEl.innerText = d.toString().padStart(2, '0');
    if (hEl) hEl.innerText = h.toString().padStart(2, '0');
    if (mEl) mEl.innerText = m.toString().padStart(2, '0');
    if (sEl) sEl.innerText = s.toString().padStart(2, '0');
}

setInterval(updateCountdown, 1000);
updateCountdown();

// --- WISHES LOGIC ---
function initWishes() {
    if (!_supabase || !EVENT_ID) return;

    const wishesForm = document.getElementById('wishes-form');
    const wishesList = document.getElementById('wishes-list');
    if (!wishesForm || !wishesList) return;

    const fetchWishes = async () => {
        const { data, error } = await _supabase
            .from('wishes')
            .select('*')
            .eq('event_id', EVENT_ID)
            .order('created_at', { ascending: false });

        if (!error) renderWishes(data);
    };

    const renderWishes = (wishes) => {
        wishesList.innerHTML = wishes.length === 0 
            ? '<p style="opacity:0.5; text-align:center; padding: 2rem;">Be the first to send blessings!</p>'
            : wishes.map(wish => `
                <div class="wish-item">
                    <h4>${escapeHTML(wish.name)}</h4>
                    <p>${escapeHTML(wish.message)}</p>
                    <small style="opacity: 0.5; font-size: 0.7rem; display: block; text-align: right;">
                        ${new Date(wish.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </small>
                </div>
            `).join('');
    };

    wishesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('wish-name').value.trim();
        const message = document.getElementById('wish-message').value.trim();
        const btn = wishesForm.querySelector('button');

        if (!name || !message) return;

        btn.disabled = true;
        const originalText = btn.innerHTML;
        btn.textContent = 'Sending...';

        const { error } = await _supabase
            .from('wishes')
            .insert([{ name, message, event_id: EVENT_ID }]);

        if (error) {
            alert('Error: ' + error.message);
        } else {
            wishesForm.reset();
            btn.innerHTML = 'Thank You! ❤️';
            setTimeout(() => { btn.innerHTML = originalText; }, 3000);
            fetchWishes();
        }
        btn.disabled = false;
    });

    _supabase.channel(`public:wishes:${EVENT_ID}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes', filter: `event_id=eq.${EVENT_ID}` }, () => {
            fetchWishes();
        }).subscribe();

    fetchWishes();
}

// --- ANIMATIONS & VIDEO ---
function initScrollReveal() {
    if (typeof ScrollReveal === 'undefined') return;
    const sr = ScrollReveal({ origin: 'bottom', distance: '40px', duration: 1200, delay: 200, reset: false });
    sr.reveal('.fade-in', { interval: 200 });
}

function startPetals() {
    const canvas = document.getElementById('petal-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let petalsArray = [];
    const petalColors = ['#D4AF37', '#E01A4F', '#FFD700', '#FFFBE6'];

    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    window.addEventListener('resize', resize);
    resize();

    class Petal {
        constructor() { this.init(); }
        init() {
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
            if (this.y > canvas.height) this.init();
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
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        petalsArray.forEach(p => { p.update(); p.draw(); });
        requestAnimationFrame(animate);
    }
    animate();
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. INJECT TEXT & METADATA
    const finalName = CONFIG.groom || "Celebrant";
    const finalInitials = CONFIG.customInitials || finalName.charAt(0);
    
    // Update elements
    document.querySelectorAll('.logo-text').forEach(el => el.innerText = finalInitials);
    document.querySelectorAll('.girl-name').forEach(el => el.innerText = finalName);
    document.querySelectorAll('.config-date').forEach(el => el.innerText = CONFIG.date || "Date TBA");
    document.querySelectorAll('.config-time').forEach(el => el.innerText = CONFIG.time || "Time TBA");
    document.querySelectorAll('.config-venue-short, .config-venue-full').forEach(el => el.innerText = CONFIG.venue || "Venue TBA");

    // Intro Text
    const introEl = document.querySelector('.invite-header');
    if (introEl) {
        if (CONFIG.introText) {
            introEl.innerHTML = CONFIG.introText.split('\n').join('<br>');
        } else {
            introEl.innerText = "Grand Celebration"; // Default for Half Saree
        }
    }

    // Loader Photo
    const loaderPhoto = document.querySelector('.loader-photo img');
    const loaderPhotoDiv = document.querySelector('.loader-photo');
    if (CONFIG.hideLoaderPhoto) {
        if (loaderPhotoDiv) loaderPhotoDiv.style.display = 'none';
    } else if (loaderPhoto) {
        if (CONFIG.loaderPhotoUrl) {
            loaderPhoto.src = optimizeUrl(CONFIG.loaderPhotoUrl);
        } else if (CONFIG.thumbnail) {
            loaderPhoto.src = optimizeUrl(CONFIG.thumbnail);
        } else if (CONFIG.gallery && CONFIG.gallery.length > 0) {
            loaderPhoto.src = optimizeUrl(CONFIG.gallery[0]);
        } else {
            if (loaderPhotoDiv) loaderPhotoDiv.style.display = 'none';
        }
        loaderPhoto.onerror = () => { if (loaderPhotoDiv) loaderPhotoDiv.style.display = 'none'; };
    }

    // Map URL - use venueUrl (embed) and venueNavigateUrl (button link)
    const mapIframe = document.getElementById('venue-iframe');
    const mapBtn = document.getElementById('venue-nav-btn');
    const venueEmbed = CONFIG.venueUrl || (CONFIG.venue ? `https://maps.google.com/maps?q=${encodeURIComponent(CONFIG.venue)}&t=&z=15&ie=UTF8&iwloc=&output=embed` : null);
    const venueNav = CONFIG.venueNavigateUrl || (CONFIG.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CONFIG.venue)}` : null);
    
    if (venueEmbed && mapIframe) {
        mapIframe.src = venueEmbed;
    }
    if (venueNav && mapBtn) {
        mapBtn.href = venueNav;
    }
    if (!venueEmbed && !venueNav) {
        const mapCard = document.querySelector('.map-card');
        if (mapCard) mapCard.style.display = 'none';
    }

    // Photographer
    const pSection = document.getElementById('footer-section');
    if (CONFIG.photographer) {
        document.getElementById('footer-studio-name').innerText = CONFIG.photographer.name;
        if (CONFIG.photographer.logo_url) {
            const logo = document.getElementById('footer-logo');
            logo.src = optimizeUrl(CONFIG.photographer.logo_url);
            logo.style.display = 'block';
        }
        if (CONFIG.photographer.phone_number) {
            const phone = document.getElementById('footer-phone');
            phone.href = `tel:${CONFIG.photographer.phone_number}`;
            phone.querySelector('span').innerText = CONFIG.photographer.phone_number;
            phone.style.display = 'inline-block';
        }
        if (CONFIG.photographer.instagram_url) {
            const insta = document.getElementById('footer-insta');
            insta.href = CONFIG.photographer.instagram_url;
            insta.style.display = 'inline-block';
        }
    } else {
        if (pSection) pSection.style.display = 'none';
    }

    // 2. HIDE EMPTY SECTIONS
    if (!CONFIG.invitationVideo) {
        const vCard = document.getElementById('video-card');
        if (vCard) vCard.style.display = 'none';
    }
    
    if (!CONFIG.youtubeId) {
        const lCard = document.getElementById('live-card');
        if (lCard) lCard.style.display = 'none';
    }

    if (!CONFIG.gallery || CONFIG.gallery.length === 0) {
        const gSec = document.getElementById('gallery-section');
        if (gSec) gSec.style.display = 'none';
    } else {
        const gSec = document.getElementById('gallery-section');
        if (gSec) gSec.style.display = 'block';
    }

    // 3. SEO METADATA
    const isSinglePerson = !CONFIG.bride || CONFIG.bride.toLowerCase() === 'family';
    const mainName = isSinglePerson ? CONFIG.groom : `${CONFIG.groom} & ${CONFIG.bride}`;
    const formattedEventType = CONFIG.eventType ? (CONFIG.eventType.charAt(0).toUpperCase() + CONFIG.eventType.slice(1)) : 'Event';
    
    const pageTitle = `${formattedEventType} of ${mainName} | Live Streaming`;
    const pageDesc = `Join us live and celebrate this beautiful traditional occasion filled with love, blessings, culture, and family moments.`;
    
    document.title = pageTitle;
    const updateMeta = (property, content) => {
        const el = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`);
        if (el && content) el.setAttribute('content', content);
    };
    updateMeta('og:title', pageTitle);
    updateMeta('og:description', pageDesc);
    updateMeta('description', pageDesc);
    if (CONFIG.thumbnail) {
        updateMeta('og:image', CONFIG.thumbnail);
        updateMeta('twitter:image', CONFIG.thumbnail);
    }

    // 4. INVITATION VIDEO SYSTEM
    const invVideo = document.getElementById('main-invitation-video');
    const videoOverlay = document.getElementById('video-play-overlay');
    
    if (invVideo && (CONFIG.invitationVideo || (CONFIG.invitationVideos && CONFIG.invitationVideos[0]))) {
        let loopCount = 0;
        const MAX_LOOPS = 3;
        let isLoopingEnabled = true;
        const videoSrc = CONFIG.invitationVideo || CONFIG.invitationVideos[0];

        // Initialize Poster & Source
        invVideo.setAttribute('poster', optimizeUrl(CONFIG.thumbnail));
        const srcTag = invVideo.querySelector('source');
        if (srcTag) srcTag.setAttribute('src', optimizeUrl(videoSrc));
        invVideo.load();

        // Handle video end
        invVideo.addEventListener('ended', () => {
            loopCount++;
            if (loopCount < MAX_LOOPS && isLoopingEnabled) {
                invVideo.play().catch(() => {});
            } else {
                stopVideoAndShowOverlay();
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
            invVideo.play().catch(() => {});
        }

        if (videoOverlay) {
            videoOverlay.addEventListener('click', startVideoManually);
        }

        // Auto-pause when not in view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (isLoopingEnabled && videoOverlay && videoOverlay.style.display === 'none') {
                        invVideo.play().catch(() => {});
                    }
                } else {
                    invVideo.pause();
                }
            });
        }, { threshold: 0.5 });

        observer.observe(invVideo);
    }

    // 5. ANALYTICS TRACKING
    const trackPageView = async () => {
        try {
            const userAgent = navigator.userAgent;
            let deviceType = 'Desktop';
            if (/Mobi|Android/i.test(userAgent)) deviceType = 'Mobile';
            else if (/Tablet|iPad/i.test(userAgent)) deviceType = 'Tablet';

            const referrer = document.referrer.includes('whatsapp') ? 'WhatsApp' : 
                             document.referrer.includes('instagram') ? 'Instagram' : 
                             document.referrer.includes('facebook') ? 'Facebook' : 'Direct';

            if (_supabase && EVENT_ID) {
                await _supabase
                    .from('page_views')
                    .insert([{
                        event_id: EVENT_ID,
                        device_type: deviceType,
                        referrer: referrer,
                        user_agent: userAgent,
                        country: CONFIG.country || 'Unknown'
                    }]);

                const { count } = await _supabase
                    .from('page_views')
                    .select('*', { count: 'exact', head: true })
                    .eq('event_id', EVENT_ID);

                const viewsDisplay = document.getElementById('total-views-display');
                if (viewsDisplay && count !== null) {
                    viewsDisplay.innerText = count.toLocaleString();
                }
            }
        } catch (e) { console.error("Analytics error:", e); }
    };
    trackPageView();
    initLiveViewerCount();
    initLangToggle();
});

// --- LANGUAGE TOGGLE (EN / Telugu) ---
const TRANSLATIONS = {
    en: {
        days: 'Days', hours: 'Hours', min: 'Min', sec: 'Sec',
        save_calendar: ' Save to Calendar',
        share_whatsapp: ' Share on WhatsApp',
        watch_live: 'Watch Live',
        join_live: ' Join Live Stream',
        watch_live_stream: ' Watch Live Stream',
        invitation_video: ' Invitation Video',
        watch_invitation: 'Watch Invitation',
        live_stream: 'Live Stream',
        watching_now: ' Watching Now',
        memories: 'Memories',
        beautiful_memories: ' Beautiful Memories',
        wishes_wall: 'Wishes Wall',
        blessings: ' Blessings',
        wishes_subtitle: 'Send your blessings to the happy couple',
        name_placeholder: 'Your Name',
        message_placeholder: 'Write your message here...',
        blessings_placeholder: 'Write your blessings here...',
        send_message: 'Send Message',
        send_wishes: 'Send Wishes ',
        locate_venue: 'Locate the Venue',
        venue: ' Venue',
        open_maps: ' Open in Google Maps',
        people_visited: ' People visited this page',
    },
    te: {
        days: 'రోజులు', hours: 'గంటలు', min: 'నిమిషాలు', sec: 'సెకన్లు',
        save_calendar: ' క్యాలెండర్‌కు జోడించండి',
        share_whatsapp: ' WhatsApp లో షేర్ చేయండి',
        watch_live: 'లైవ్ చూడండి',
        join_live: ' లైవ్ స్ట్రీమ్ లో చేరండి',
        watch_live_stream: ' లైవ్ స్ట్రీమ్ చూడండి',
        invitation_video: ' ఆహ్వాన వీడియో',
        watch_invitation: 'ఆహ్వానం చూడండి',
        live_stream: 'లైవ్ స్ట్రీమ్',
        watching_now: ' చూస్తున్నారు',
        memories: 'అందమైన జ్ఞాపకాలు',
        beautiful_memories: ' అందమైన జ్ఞాపకాలు',
        wishes_wall: 'శుభాకాంక్షలు',
        blessings: ' ఆశీర్వాదాలు',
        wishes_subtitle: 'జంటకు మీ శుభాకాంక్షలు తెలియజేయండి',
        name_placeholder: 'మీ పేరు',
        message_placeholder: 'మీ సందేశం ఇక్కడ రాయండి...',
        blessings_placeholder: 'మీ ఆశీర్వాదాలు ఇక్కడ రాయండి...',
        send_message: 'సందేశం పంపండి',
        send_wishes: 'శుభాకాంక్షలు పంపండి ',
        locate_venue: 'వేదిక స్థానం',
        venue: ' వేదిక',
        open_maps: ' Google Maps లో తెరవండి',
        people_visited: ' మంది ఈ పేజీని సందర్శించారు',
    }
};

let currentLang = localStorage.getItem('ec_lang') || 'en';

function applyLocale(lang) {
    currentLang = lang;
    localStorage.setItem('ec_lang', lang);
    const t = TRANSLATIONS[lang];

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (t[key] === undefined) return;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.placeholder = t[key];
        } else {
            el.textContent = t[key];
        }
    });

    const enLabel = document.getElementById('lang-label-en');
    const teLabel = document.getElementById('lang-label-te');
    if (enLabel && teLabel) {
        enLabel.classList.toggle('lang-active', lang === 'en');
        teLabel.classList.toggle('lang-active', lang === 'te');
    }

    document.body.classList.toggle('lang-te', lang === 'te');
}

function initLangToggle() {
    const btn = document.getElementById('lang-toggle-btn');
    if (btn) {
        btn.addEventListener('click', () => applyLocale(currentLang === 'en' ? 'te' : 'en'));
    }
    applyLocale(currentLang);
}

// --- LIVE VIEWER COUNT (Supabase Realtime Presence) ---
function initLiveViewerCount() {
    if (!_supabase || !CONFIG.eventId) return;

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

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            channel.untrack();
        } else {
            channel.track({ joined_at: new Date().toISOString() });
        }
    });
}
