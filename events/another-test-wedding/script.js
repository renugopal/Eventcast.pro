// --- CONFIG DRIVEN LOGIC ---
// These values should be provided by config.js
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

const WEDDING_DATE = new Date(CONFIG.timerTarget).getTime();

// --- SUPABASE WISHES LOGIC ---
const _supabase = (CONFIG.supabaseUrl && CONFIG.supabaseKey) 
    ? supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey) 
    : null;

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
        }
    }

    // --- SEO & TITLE UPDATE ---
    const pageTitle = `${CONFIG.groom} ${CONFIG.bride ? '❤️ ' + CONFIG.bride : ''} ${CONFIG.eventType} | Eventcast PRO`;
    document.title = pageTitle;
    const updateMeta = (property, content) => {
        const el = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`);
        if (el) el.setAttribute('content', content);
    };
    updateMeta('og:title', pageTitle);
    updateMeta('og:description', `Join us live for the ${CONFIG.eventType} of ${CONFIG.groom} ${CONFIG.bride ? '& ' + CONFIG.bride : ''}.`);
    updateMeta('description', `Join us live for the ${CONFIG.eventType} of ${CONFIG.groom} ${CONFIG.bride ? '& ' + CONFIG.bride : ''}.`);
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
        const calTitle = encodeURIComponent(`${CONFIG.groom} ${CONFIG.bride ? '& ' + CONFIG.bride : ''} ${CONFIG.eventType}`);
        const calDate = new Date(CONFIG.timerTarget).toISOString().replace(/-|:|\.\d\d\d/g, "");
        const calEndDate = new Date(new Date(CONFIG.timerTarget).getTime() + 3600000).toISOString().replace(/-|:|\.\d\d\d/g, "");
        const calDetails = encodeURIComponent(`Join us live and bless the couple: ${window.location.href}`);
        const calLoc = encodeURIComponent(CONFIG.venue);
        saveCalBtn.href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&dates=${calDate}/${calEndDate}&details=${calDetails}&location=${calLoc}`;
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
                await _supabase
                    .from('page_views')
                    .insert([{
                        event_id: CONFIG.eventId,
                        device_type: deviceType,
                        referrer: referrer,
                        user_agent: userAgent
                    }]);

                // 2. Count total visits for this event accurately
                const { count } = await _supabase
                    .from('page_views')
                    .select('*', { count: 'exact', head: true })
                    .eq('event_id', CONFIG.eventId);

                // 3. Update UI with accurate count
                const viewsDisplay = document.getElementById('total-views-display');
                if (viewsDisplay && count !== null) {
                    viewsDisplay.innerText = count.toLocaleString();
                }
            }
        } catch (e) { console.error("Analytics error:", e); }
    };
    trackPageView();
    
    // Inject Info
    const infoItems = document.querySelectorAll('.info-text');
    if (infoItems[0]) infoItems[0].innerText = CONFIG.date;
    if (infoItems[1]) infoItems[1].innerText = CONFIG.time;
    if (infoItems[2]) infoItems[2].innerText = CONFIG.venue;
    
    const subtexts = document.querySelectorAll('.info-subtext');
    if (subtexts[0]) subtexts[0].innerText = CONFIG.timeSubtext || '';
    if (subtexts[1]) subtexts[1].innerText = CONFIG.venueSubtext || '';

    // Dynamic Time Label (e.g. 'Sumuhurtham' / 'Wedding' / 'Ceremony')
    const heroInfoItems = document.querySelectorAll('.hero-info-item');
    if (heroInfoItems[1]) {
        const lbl = heroInfoItems[1].querySelector('.info-label');
        if (lbl) lbl.innerText = CONFIG.timeLabel || 'Sumuhurtham';
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

        invVideo.setAttribute('poster', optimizeUrl(CONFIG.thumbnail));

        function playVideoAt(index) {
            currentVideoIndex = index;
            const src = invVideo.querySelector('source');
            if (src) src.setAttribute('src', optimizeUrl(allVideos[index]));
            invVideo.load();
            
            // Only play if in viewport or manually triggered
            if (videoOverlay && videoOverlay.style.display === 'none') {
                invVideo.play().catch(() => {});
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
            invVideo.play().catch(() => {});
        }

        if (videoOverlay) {
            videoOverlay.addEventListener('click', startVideoManually);
        }

        // --- Intersection Observer: Play only when visible ---
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && isLoopingEnabled) {
                    invVideo.play().catch(() => {});
                } else {
                    invVideo.pause();
                }
            });
        }, { threshold: 0.3 });

        if (videoWrapper) observer.observe(videoWrapper);

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

        playVideoAt(0);
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

        if (name) {
            name.innerText = CONFIG.photographer.name;
            name.style.display = 'block';
        }
        
        if (phone && CONFIG.photographer.phone_number) {
            phone.href = `tel:${CONFIG.photographer.phone_number}`;
            phone.querySelector('span').innerText = CONFIG.photographer.phone_number;
            phone.style.display = 'block';
        } else if (phone) phone.style.display = 'none';

        if (insta && CONFIG.photographer.instagram_url) {
            insta.href = CONFIG.photographer.instagram_url;
            insta.style.display = 'block';
        } else if (insta) insta.style.display = 'none';
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

    if (!CONFIG.youtubeId && !CONFIG.restreamerPlayer) {
        if (livestreamSection) livestreamSection.style.display = 'none';
        return;
    }

    // 1. Check if we have a Restreamer Player (High Quality Choice)
    if (CONFIG.restreamerUrl) {
        console.log("Using Native HLS Player for Restreamer...");
        if (playerContainer) {
            playerContainer.innerHTML = `
                <div class="plyr-container" style="position:relative; width:100%; height:100%; border-radius:12px; overflow:hidden;">
                    <video id="hls-video" controls width="100%" height="100%" playsinline></video>
                    <div id="hls-loader" class="hls-loader-container" style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:10;">
                        <i class="fas fa-spinner fa-spin" style="font-size:3rem; margin-bottom:15px;"></i>
                        <p style="font-family:'Playfair Display', serif; letter-spacing:2px; text-transform:uppercase;">Waiting for Stream to Start...</p>
                    </div>
                </div>
            `;
            
            // Add an attractive YouTube Link button below
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

            const tryLoadStream = () => {
                if (isPlaying) return;
                
                fetch(CONFIG.restreamerUrl, { method: 'HEAD', cache: 'no-store' })
                    .then(res => {
                        if (res.ok) {
                            // Stream is live!
                            loader.style.display = 'none';
                            isPlaying = true;
                            updateStatus(true);
                            
                            if (Hls.isSupported()) {
                                hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 30 });
                                hls.loadSource(CONFIG.restreamerUrl);
                                hls.attachMedia(video);
                                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                                    // Initialize Plyr after HLS is ready
                                    player = new Plyr(video, {
                                        controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
                                        settings: ['quality', 'speed'],
                                        quality: { default: 1080, options: [1080, 720, 576, 480, 360] },
                                        tooltips: { controls: true, seek: true },
                                        i18n: { play: 'Play Live', pause: 'Pause Live' }
                                    });
                                    video.play().catch(e => console.log("Autoplay prevented:", e));
                                });
                            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                                video.src = CONFIG.restreamerUrl;
                                player = new Plyr(video, {
                                    controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen']
                                });
                                video.addEventListener('loadedmetadata', function() {
                                    video.play().catch(e => console.log("Autoplay prevented:", e));
                                });
                            }
                        } else {
                            setTimeout(tryLoadStream, 5000);
                        }
                    })
                    .catch(() => {
                        setTimeout(tryLoadStream, 5000);
                    });
            };
            
            tryLoadStream();
        }
        return; // Skip standard YouTube player setup
    }

    // 2. Fallback to standard YouTube Player API
    if (CONFIG.youtubeId) {
        player = new YT.Player('youtube-player', {
            height: '100%',
            width: '100%',
            videoId: CONFIG.youtubeId,
            playerVars: {
                'playsinline': 1,
                'rel': 0,
                'modestbranding': 1
            },
            events: {
                'onStateChange': onPlayerStateChange
            }
        });
    }
}

function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.PLAYING) {
        // Handle audio if needed
    }
}

// --- COUNTDOWN TIMER ---
function updateCountdown() {
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

// --- FALLING PETALS ANIMATION ---
function startPetals() {
    const canvas = document.getElementById('petal-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let petalsArray = [];
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
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        petalsArray.forEach(petal => {
            petal.update();
            petal.draw();
        });
        requestAnimationFrame(animate);
    }
    animate();
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
