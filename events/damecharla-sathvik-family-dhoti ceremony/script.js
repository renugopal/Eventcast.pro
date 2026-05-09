// --- CONFIG DRIVEN LOGIC ---
const CONFIG = window.WEDDING_CONFIG || {
    groom: "Aryan",
    bride: "family",
    date: "Sunday, June 15th",
    time: "10:30 AM",
    timerTarget: "2026-06-15T10:30:00",
    venue: "Venue TBA",
    youtubeId: "",
    invitationVideo: "",
    thumbnail: "assets/thumbnail.png",
    gallery: [],
    supabaseUrl: '',
    supabaseKey: '',
    eventId: 'dhoti-ceremony-01',
    eventType: 'Dhoti Ceremony'
};

const EVENT_DATE = new Date(CONFIG.timerTarget).getTime();
const EVENT_ID = CONFIG.eventId;
const _supabase = (CONFIG.supabaseUrl && CONFIG.supabaseKey) 
    ? supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey) 
    : null;

// --- UTILS ---
const optimizeUrl = (url) => {
    if (!url) return '';
    if (!url.includes('cloudinary.com')) return url;
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
    initSlideshow();
    initWishes();
});

// --- SLIDESHOW LOGIC ---
function initSlideshow() {
    const slideshowContainer = document.querySelector('.slideshow-container');
    if (!slideshowContainer) return;

    const gallery = CONFIG.gallery && CONFIG.gallery.length > 0 ? CONFIG.gallery : [];
    if (gallery.length === 0) {
        document.getElementById('gallery-section').style.display = 'none';
        return;
    }
    
    document.getElementById('gallery-section').style.display = 'block';

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

    function nextSlide() { showSlide(currentSlide + 1); }

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

// --- YOUTUBE PLAYER ---
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
        playerVars: { 'playsinline': 1, 'rel': 0, 'modestbranding': 1 }
    });
}

// --- COUNTDOWN ---
function updateCountdown() {
    const now = new Date().getTime();
    const distance = EVENT_DATE - now;
    const wrapper = document.querySelector('.countdown-glass');
    if (!wrapper) return;

    if (distance < 0) {
        wrapper.innerHTML = `<h3 style="color: var(--primary); font-family: 'Cinzel', serif; text-align: center; width: 100%;">The Ceremony has started! 🎉</h3>`;
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

// --- WISHES ---
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
            ? '<p style="opacity:0.5; text-align:center; padding: 2rem;">Send your blessings to Aryan!</p>'
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
            btn.innerHTML = 'Sent Successfully! ❤️';
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

// --- ANIMATION (Akshata / Petals) ---
function startPetals() {
    const canvas = document.getElementById('petal-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let petalsArray = [];
    // Traditional colors: Yellow (Marigold), Gold (Akshata), White
    const petalColors = ['#FFD700', '#FFCC00', '#FFFBE6', '#F4D03F'];

    function resize() { 
        canvas.width = window.innerWidth; 
        canvas.height = window.innerHeight; 
    }
    window.addEventListener('resize', resize);
    resize();

    class Petal {
        constructor() { this.init(); }
        init() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height - canvas.height;
            this.size = Math.random() * 6 + 3; // Smaller for grain look
            this.speedX = Math.random() * 1 - 0.5;
            this.speedY = Math.random() * 1.5 + 0.5;
            this.color = petalColors[Math.floor(Math.random() * petalColors.length)];
            this.rotation = Math.random() * 360;
            this.rotationSpeed = Math.random() * 3 - 1.5;
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
            // Grain shape
            ctx.ellipse(0, 0, this.size, this.size / 2.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    for (let i = 0; i < 60; i++) petalsArray.push(new Petal());
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        petalsArray.forEach(p => { p.update(); p.draw(); });
        requestAnimationFrame(animate);
    }
    animate();
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. INJECT DATA
    const name = CONFIG.groom || "Celebrant";
    
    document.querySelectorAll('.logo-text').forEach(el => el.innerText = name);
    document.querySelectorAll('.girl-name').forEach(el => el.innerText = name);
    document.querySelectorAll('.config-date').forEach(el => el.innerText = CONFIG.date || "Date TBA");
    document.querySelectorAll('.config-time').forEach(el => el.innerText = CONFIG.time || "Time TBA");
    document.querySelectorAll('.config-venue-short, .config-venue-full').forEach(el => el.innerText = CONFIG.venue || "Venue TBA");

    if (CONFIG.introText) {
        const intro = document.querySelector('.invite-header');
        if (intro) intro.innerHTML = CONFIG.introText.split('\n').join('<br>');
    }

    // Loader Photo
    const loaderImg = document.querySelector('.loader-photo img');
    if (loaderImg && CONFIG.thumbnail) loaderImg.src = optimizeUrl(CONFIG.thumbnail);

    // Map
    const mapIframe = document.getElementById('venue-iframe');
    const mapBtn = document.getElementById('venue-nav-btn');
    const venue = CONFIG.venue;
    if (venue && venue !== "Venue TBA") {
        if (mapIframe) mapIframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(venue)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
        if (mapBtn) mapBtn.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
    } else {
        const mapCard = document.querySelector('.map-card');
        if (mapCard) mapCard.style.display = 'none';
    }

    // Photographer & Analytics
    if (CONFIG.photographer) {
        document.getElementById('footer-studio-name').innerText = CONFIG.photographer.name;
        const logo = document.getElementById('footer-logo');
        if (CONFIG.photographer.logo_url) {
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
    }

    // Hide empty sections
    if (!CONFIG.invitationVideo) {
        const vCard = document.getElementById('video-card');
        if (vCard) vCard.style.display = 'none';
    }
    if (!CONFIG.youtubeId) {
        const lCard = document.getElementById('live-card');
        if (lCard) lCard.style.display = 'none';
    }

    // Analytics
    const trackView = async () => {
        if (!_supabase || !EVENT_ID) return;
        try {
            await _supabase.from('page_views').insert([{ event_id: EVENT_ID, device_type: /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop' }]);
            const { count } = await _supabase.from('page_views').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID);
            const display = document.getElementById('total-views-display');
            if (display && count !== null) display.innerText = count.toLocaleString();
        } catch (e) {}
    };
    trackView();

    // SEO METADATA
    const isSinglePerson = !CONFIG.bride || CONFIG.bride.toLowerCase() === 'family';
    const mainName = isSinglePerson ? CONFIG.groom : `${CONFIG.groom} & ${CONFIG.bride}`;
    const formattedEventType = CONFIG.eventType || 'Dhoti Ceremony';
    
    // Format Date for Title (e.g., "June 15th")
    let titleDate = '';
    if (CONFIG.date) {
        // Try to extract the day and month from the string
        titleDate = CONFIG.date.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*/i, '');
    }

    const pageTitle = `✨ ${mainName} ${formattedEventType} Live | ${titleDate}`;
    const pageDesc = `Join us live to celebrate this beautiful traditional occasion filled with blessings, happiness, culture, and family moments.`;
    
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

    // Invitation Video
    const video = document.getElementById('main-invitation-video');
    const overlay = document.getElementById('video-play-overlay');
    if (video && CONFIG.invitationVideo) {
        video.querySelector('source').src = optimizeUrl(CONFIG.invitationVideo);
        video.load();
        overlay.addEventListener('click', () => {
            overlay.style.display = 'none';
            video.play();
        });
        video.addEventListener('ended', () => {
            overlay.style.display = 'flex';
        });
    }
});
