// --- CONFIG DRIVEN LOGIC ---
const CONFIG = window.WEDDING_CONFIG || {
    groom: "Bhavagna",
    bride: "Naga Sai",
    date: "May 8th 2026",
    time: "09:45 AM",
    timerTarget: "2026-05-08T09:30:00",
    venue: "B Convention Hall",
    youtubeId: "",
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
    return url.replace('/upload/', '/upload/f_auto,q_auto/');
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

// --- YOUTUBE PLAYER API ---
var ytScriptTag = document.createElement('script');
ytScriptTag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(ytScriptTag, firstScriptTag);

let player;
function onYouTubeIframeAPIReady() {
    if (!CONFIG.youtubeId) return;
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

    // 4. INVITATION VIDEO OBSERVER LOGIC
    const invVideo = document.getElementById('main-invitation-video');
    if (invVideo && CONFIG.invitationVideo) {
        invVideo.src = CONFIG.invitationVideo + (CONFIG.invitationVideo.includes('?') ? '&' : '?') + 'v=1.2';
        invVideo.muted = true;
        
        let playCount = 0;
        const MAX_LOOPS = 3;

        invVideo.addEventListener('ended', () => {
            playCount++;
            if (playCount < MAX_LOOPS) {
                invVideo.play().catch(e => console.log('Loop play prevented', e));
            }
        });

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (playCount < MAX_LOOPS) {
                        invVideo.play().catch(e => console.log('Autoplay prevented', e));
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
                        user_agent: userAgent
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
});
