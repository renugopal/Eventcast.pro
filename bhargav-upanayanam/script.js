// ===== SCROLL REVEAL (IntersectionObserver — works on file:// too) =====
function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');
    // Initially hide them
    reveals.forEach(el => el.classList.add('hidden'));
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.remove('hidden');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(el => observer.observe(el));
}

const CONFIG = window.UPANAYANAM_CONFIG || {
    celebrantName: "వటువు",
    fatherName: "", motherName: "",
    hostNames: [],
    date: "తేదీ", muhurthamTime: "మహూర్తం",
    venue: "వేదిక", venueSubtext: "",
    venueMapLink: "", timerTarget: new Date().toISOString(),
    youtubeId: "", invitationVideo: "", invitationVideos: [],
    thumbnail: "", gallery: [],
    aboutText: "", supabaseUrl: "", supabaseKey: "", eventId: "",
    photographer: null
};

// ===== CLOUDINARY OPTIMIZATION =====
const optimizeUrl = (url) => {
    if (!url || !url.includes('cloudinary.com')) return url;
    if (url.includes('/upload/')) return url.replace('/upload/', '/upload/f_auto,q_auto/');
    return url;
};

// ===== SUPABASE CLIENT =====
let _supabase = null;
if (CONFIG.supabaseUrl && CONFIG.supabaseKey) {
    _supabase = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
}

// ===== DOM CONTENT LOADED =====
document.addEventListener('DOMContentLoaded', () => {

    // --- Loader name ---
    const loaderName = document.getElementById('loader-name');
    if (loaderName && CONFIG.celebrantName) loaderName.innerText = CONFIG.celebrantName;

    // --- SEO Meta Update (skip if HTML already has specific values) ---
    // document.title override disabled — title set directly in HTML
    // const metaDesc = document.querySelector('meta[name="description"]');
    if (CONFIG.thumbnail) {
        const ogImg = document.querySelector('meta[property="og:image"]');
        if (ogImg) ogImg.content = optimizeUrl(CONFIG.thumbnail);
    }

    // --- Hero: Celebrant Name ---
    const celebrantEl = document.getElementById('celebrant-name');
    if (celebrantEl) celebrantEl.innerText = CONFIG.celebrantName;

    // --- Hero: Parents Line ---
    const parentsEl = document.getElementById('parents-line');
    if (parentsEl && CONFIG.fatherName && CONFIG.motherName) {
        parentsEl.innerText = `${CONFIG.fatherName} - ${CONFIG.motherName} గారి పుత్రుడు`;
    } else if (parentsEl) { parentsEl.style.display = 'none'; }

    // --- Hero: Event Info ---
    const dateEl = document.getElementById('event-date');
    if (dateEl && CONFIG.date) dateEl.innerText = CONFIG.date;
    const muhEl = document.getElementById('event-muhurtham');
    if (muhEl && CONFIG.muhurthamTime) muhEl.innerText = CONFIG.muhurthamTime;
    const venueEl = document.getElementById('event-venue');
    if (venueEl && CONFIG.venue) {
        venueEl.innerText = CONFIG.venueSubtext ? `${CONFIG.venue}, ${CONFIG.venueSubtext}` : CONFIG.venue;
    }

    // --- Save to Calendar Button ---
    const calBtn = document.getElementById('calendar-btn');
    if (calBtn && CONFIG.timerTarget) {
        const start = CONFIG.timerTarget.replace(/[-:]/g, '').replace('.000', '');
        const calTitle = encodeURIComponent(`చి॥ ${CONFIG.celebrantName} ఉపనయన మహోత్సవం`);
        const calLocation = encodeURIComponent(`${CONFIG.venue}, ${CONFIG.venueSubtext}`);
        const calDesc = encodeURIComponent(`లైవ్‌స్ట్రీమ్: ${window.location.href}`);
        calBtn.href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&dates=${start}/${start}&location=${calLocation}&details=${calDesc}`;
    }

    // --- WhatsApp Share ---
    const waBtn = document.getElementById('whatsapp-share-btn');
    if (waBtn) {
        waBtn.addEventListener('click', () => {
            const msg = `🙏 చి॥ ${CONFIG.celebrantName} ఉపనయన మహోత్సవం\n📅 ${CONFIG.date}\n⏰ మహూర్తం: ${CONFIG.muhurthamTime}\n📍 ${CONFIG.venue}, ${CONFIG.venueSubtext}\n\nలైవ్ చూడటానికి: ${window.location.href}`;
            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
        });
    }

    // --- Invitation Video: Auto-Playlist ---
    const invVideoSection = document.getElementById('invitation-video');
    const invVideo = document.getElementById('main-invitation-video');
    const videoDotsContainer = document.getElementById('video-dots');
    const allVideos = CONFIG.invitationVideos && CONFIG.invitationVideos.length > 0
        ? CONFIG.invitationVideos
        : (CONFIG.invitationVideo ? [CONFIG.invitationVideo] : []);

    if (allVideos.length > 0) {
        let currentVideoIndex = 0;

        function playVideoAt(index) {
            currentVideoIndex = index;
            if (invVideo) {
                const src = invVideo.querySelector('source');
                if (src) src.setAttribute('src', allVideos[index]);
                invVideo.load(); invVideo.play().catch(() => {});
            }
            if (allVideos.length > 1 && videoDotsContainer) {
                videoDotsContainer.querySelectorAll('.vdot').forEach((d, i) => {
                    d.style.background = i === index ? 'var(--gold)' : 'rgba(201,168,76,0.3)';
                    d.style.transform = i === index ? 'scale(1.4)' : 'scale(1)';
                });
            }
        }

        if (invVideo) {
            invVideo.setAttribute('poster', optimizeUrl(CONFIG.thumbnail));
            if (allVideos.length === 1) {
                invVideo.setAttribute('loop', '');
                invVideo.src = allVideos[0];
                invVideo.load();
                invVideo.play().catch(() => {});
            } else {
                invVideo.removeAttribute('loop');
                invVideo.addEventListener('ended', () => playVideoAt((currentVideoIndex + 1) % allVideos.length));
                videoDotsContainer.style.display = 'flex';
                videoDotsContainer.innerHTML = allVideos.map((_, i) => `
                    <span class="vdot" style="width:10px;height:10px;border-radius:50%;display:inline-block;cursor:pointer;transition:all 0.3s;background:${i===0?'var(--gold)':'rgba(201,168,76,0.3)'};transform:${i===0?'scale(1.4)':'scale(1)'};" onclick="window._playVideoAt(${i})"></span>
                `).join('');
                window._playVideoAt = playVideoAt;
                playVideoAt(0);
            }
        }
    } else {
        if (invVideoSection) invVideoSection.style.display = 'none';
    }

    // --- About Text ---
    const aboutEl = document.getElementById('about-text');
    if (aboutEl && CONFIG.aboutText) aboutEl.innerText = CONFIG.aboutText;

    // --- Blessings Subtitle ---
    const blessSubEl = document.getElementById('blessings-subtitle');
    if (blessSubEl && CONFIG.celebrantName) {
        blessSubEl.innerText = `చి॥ ${CONFIG.celebrantName} కు మీ ఆశీర్వాదాలు తెలియజేయండి`;
    }

    // --- Photo Gallery ---
    const photoSection = document.getElementById('photo-gallery');
    const slideshowWrapper = document.querySelector('.slideshow-wrapper');
    const dotsContainer = document.querySelector('.ss-dots');

    if (CONFIG.gallery && CONFIG.gallery.length > 0) {
        if (slideshowWrapper) {
            slideshowWrapper.innerHTML = CONFIG.gallery.map((url, i) => `
                <div class="slide ${i === 0 ? 'active' : ''}">
                    <div class="slide-bg" style="background-image:url('${optimizeUrl(url)}');"></div>
                    <img src="${optimizeUrl(url)}" alt="Memory ${i+1}" class="gallery-img">
                </div>
            `).join('');
        }
        if (dotsContainer) {
            dotsContainer.innerHTML = CONFIG.gallery.map((_, i) => `<span class="dot ${i===0?'active':''}"></span>`).join('');
        }
    } else {
        if (photoSection) photoSection.style.display = 'none';
    }

    // --- Venue Map ---
    const mapIframe = document.getElementById('venue-map');
    const mapLink = document.getElementById('map-link');
    if (CONFIG.venueMapLink) {
        // Construct embeddable URL from venue address (short URLs can't be iframed)
        const encVenue = encodeURIComponent(`${CONFIG.venue}, ${CONFIG.venueSubtext}`);
        const embedUrl = `https://www.google.com/maps?q=${encVenue}&output=embed`;
        if (mapIframe) mapIframe.src = embedUrl;
        if (mapLink) mapLink.href = CONFIG.venueMapLink; // button opens original link
    } else {
        const mapSection = document.getElementById('map-section');
        if (mapSection) mapSection.style.display = 'none';
    }

    // --- Itlu Section ---
    const itluNames = document.getElementById('itlu-names');
    if (itluNames && CONFIG.hostNames && CONFIG.hostNames.length > 0) {
        itluNames.innerHTML = CONFIG.hostNames.map(n => `<p>${n}</p>`).join('');
    } else if (itluNames) {
        const itluSection = document.getElementById('itlu-section');
        if (itluSection) itluSection.style.display = 'none';
    }

    // --- Photographer Footer ---
    const logo = document.getElementById('photo-logo');
    const studioName = document.getElementById('studio-name');
    const pPhone = document.getElementById('p-phone');
    const pInsta = document.getElementById('p-insta');

    if (CONFIG.photographer) {
        if (logo && CONFIG.photographer.logo_url) {
            logo.src = optimizeUrl(CONFIG.photographer.logo_url);
            logo.style.display = 'block';
        }
        if (studioName && CONFIG.photographer.name) {
            studioName.innerText = CONFIG.photographer.name;
            studioName.style.display = 'block';
        }
        if (pPhone && CONFIG.photographer.phone_number) {
            pPhone.href = `tel:${CONFIG.photographer.phone_number}`;
            pPhone.querySelector('span').innerText = CONFIG.photographer.phone_number;
            pPhone.style.display = 'flex';
        }
        if (pInsta && CONFIG.photographer.instagram_url) {
            pInsta.href = CONFIG.photographer.instagram_url;
            pInsta.style.display = 'flex';
        }
    }

    // --- Analytics ---
    if (_supabase && CONFIG.eventId) {
        (async () => {
            try {
                const ua = navigator.userAgent;
                let device = /Mobi|Android/i.test(ua) ? 'Mobile' : /Tablet|iPad/i.test(ua) ? 'Tablet' : 'Desktop';
                const ref = document.referrer;
                const referrer = ref.includes('whatsapp') ? 'WhatsApp' : ref.includes('instagram') ? 'Instagram' : ref.includes('facebook') ? 'Facebook' : 'Direct';
                await _supabase.from('page_views').insert([{ event_id: CONFIG.eventId, device_type: device, referrer }]);
                const { count } = await _supabase.from('page_views').select('*', { count: 'exact', head: true }).eq('event_id', CONFIG.eventId);
                const el = document.getElementById('total-views-display');
                if (el && count !== null) el.innerText = count.toLocaleString();
            } catch(e) { console.error('Analytics:', e); }
        })();
    }
});

// ===== LOADER =====
window.addEventListener('load', () => {
    const loader = document.getElementById('loader');
    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 500);
    }, 1400);
    startPetals();
    initScrollReveal();
    initSlideshow();
});

// ===== COUNTDOWN =====
const CEREMONY_DATE = new Date(CONFIG.timerTarget).getTime();

function updateCountdown() {
    const now = Date.now();
    const distance = CEREMONY_DATE - now;
    if (distance < 0) {
        const wrap = document.querySelector('.countdown-wrapper');
        if (wrap) wrap.innerHTML = `<h3 style="font-family:'Noto Serif Telugu',serif;color:var(--saffron);font-size:1.4rem;">వేడుక ప్రారంభమైంది! 🎉</h3>`;
        const liveBtn = document.getElementById('floating-live-btn');
        if (liveBtn) liveBtn.style.display = 'flex';
        const badge = document.querySelector('.status-badge');
        if (badge) badge.innerHTML = `<span class="pulse"></span> LIVE NOW`;
        return;
    }
    const d = Math.floor(distance / 86400000);
    const h = Math.floor((distance % 86400000) / 3600000);
    const m = Math.floor((distance % 3600000) / 60000);
    const s = Math.floor((distance % 60000) / 1000);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = String(val).padStart(2,'0'); };
    set('days', d); set('hours', h); set('minutes', m); set('seconds', s);
}
setInterval(updateCountdown, 1000);
updateCountdown();

// ===== YOUTUBE PLAYER =====
if (CONFIG.youtubeId) {
    const ytTag = document.createElement('script');
    ytTag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(ytTag);
} else {
    // Show placeholder when no YouTube ID
    const ytPlayer = document.getElementById('youtube-player');
    if (ytPlayer) {
        ytPlayer.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:rgba(255,255,255,0.5);height:100%;';
        ytPlayer.innerHTML = `
            <span style="font-size:3rem;">📺</span>
            <p style="font-family:'Noto Serif Telugu',serif;font-size:0.9rem;">వేడుక సమయంలో ఇక్కడ లైవ్ చూడవచ్చు</p>
        `;
    }
}
function onYouTubeIframeAPIReady() {
    if (!CONFIG.youtubeId) return;
    new YT.Player('youtube-player', {
        height: '100%', width: '100%',
        videoId: CONFIG.youtubeId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 }
    });
}

// ===== SLIDESHOW =====
function initSlideshow() {
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    const prev = document.querySelector('.ss-prev');
    const next = document.querySelector('.ss-next');
    if (!slides.length) return;
    let cur = 0, iv;

    function show(n) {
        slides[cur].classList.remove('active');
        if (dots[cur]) dots[cur].classList.remove('active');
        cur = (n + slides.length) % slides.length;
        slides[cur].classList.add('active');
        if (dots[cur]) dots[cur].classList.add('active');
    }
    function reset() { clearInterval(iv); iv = setInterval(() => show(cur + 1), 5000); }
    prev?.addEventListener('click', () => { show(cur - 1); reset(); });
    next?.addEventListener('click', () => { show(cur + 1); reset(); });
    dots.forEach((d, i) => d.addEventListener('click', () => { show(i); reset(); }));
    iv = setInterval(() => show(cur + 1), 5000);
}

// (Scroll reveal handled by IntersectionObserver above — see initScrollReveal at top)

// ===== FALLING PETALS (Marigold / Saffron) =====
function startPetals() {
    const canvas = document.getElementById('petal-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });

    const colors = ['#E8831A', '#C9A84C', '#FFF0A0', '#FFDAB9', '#F0DFA0'];
    const petals = Array.from({ length: 35 }, () => new Petal());

    function Petal() { this.reset(); }
    Petal.prototype.reset = function() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height - canvas.height;
        this.size = Math.random() * 8 + 4;
        this.speedX = Math.random() * 1 - 0.5;
        this.speedY = Math.random() * 1.2 + 0.5;
        this.color = colors[Math.floor(Math.random() * colors.length)];
        this.rotation = Math.random() * 360;
        this.rotSpeed = Math.random() * 2 - 1;
        this.opacity = Math.random() * 0.5 + 0.3;
    };
    Petal.prototype.update = function() {
        this.y += this.speedY; this.x += this.speedX;
        this.rotation += this.rotSpeed;
        if (this.y > canvas.height + 20) this.reset();
    };
    Petal.prototype.draw = function() {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation * Math.PI / 180);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, this.size, this.size / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };

    (function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        petals.forEach(p => { p.update(); p.draw(); });
        requestAnimationFrame(animate);
    })();
}

// ===== SUPABASE WISHES =====
const wishesForm = document.getElementById('wishes-form');
const wishesList = document.getElementById('wishes-list');
const nameInput = document.getElementById('wish-name');
const messageInput = document.getElementById('wish-message');

function renderWish(wish) {
    const d = new Date(wish.created_at);
    const timeStr = d.toLocaleDateString('te-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = 'wish-card';
    div.innerHTML = `
        <div class="wish-name">${wish.name}</div>
        <div class="wish-message">${wish.message}</div>
        <div class="wish-time">${timeStr}</div>
    `;
    return div;
}

async function fetchWishes() {
    if (!_supabase || !wishesList || !CONFIG.eventId) return;
    const { data } = await _supabase.from('wishes').select('*').eq('event_id', CONFIG.eventId).order('created_at', { ascending: false }).limit(30);
    if (data) {
        wishesList.innerHTML = '';
        data.forEach(w => wishesList.appendChild(renderWish(w)));
    }
}

if (wishesForm && _supabase) {
    fetchWishes();
    wishesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        const message = messageInput.value.trim();
        if (!name || !message) return;
        const btn = wishesForm.querySelector('button[type="submit"]');
        btn.disabled = true; btn.innerText = 'పంపుతున్నాం...';
        const { error } = await _supabase.from('wishes').insert([{ event_id: CONFIG.eventId, name, message }]);
        if (!error) { nameInput.value = ''; messageInput.value = ''; await fetchWishes(); }
        btn.disabled = false;
        btn.innerHTML = 'ఆశీర్వాదం పంపండి <i class="fas fa-paper-plane"></i>';
    });

    // Real-time
    if (CONFIG.eventId) {
        _supabase.channel(`wishes-${CONFIG.eventId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes', filter: `event_id=eq.${CONFIG.eventId}` }, () => fetchWishes())
            .subscribe();
    }
}
