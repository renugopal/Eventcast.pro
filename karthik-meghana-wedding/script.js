// --- CONFIG ---
const WEDDING_DATE = new Date('May 18, 2026 10:00:00').getTime();
const SUPABASE_URL = 'https://ntjqjmuripwexwlhfrny.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vi_vz9qfKMJnEymw3WaPpg_2A6SeSWR';
const YOUTUBE_VIDEO_ID = 'dQw4w9WgXcQ'; // Replace with actual livestream ID
const EVENT_ID = 'karthik-meghana-wedding';

// --- INIT ---
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- LOADER ---
window.addEventListener('load', () => {
    const loader = document.getElementById('loader');
    setTimeout(() => {
        loader.style.opacity = '0';
        loader.style.transition = 'opacity 0.6s ease';
        setTimeout(() => { loader.style.display = 'none'; }, 600);
    }, 1400);

    startPetals();
    initScrollReveal();
    initMusic();
    initSlideshow();
});

// --- YOUTUBE PLAYER ---
let player;
function onYouTubeIframeAPIReady() {
    player = new YT.Player('youtube-player', {
        height: '100%', width: '100%',
        videoId: YOUTUBE_VIDEO_ID,
        playerVars: { 'playsinline': 1, 'rel': 0, 'modestbranding': 1 },
        events: { 'onStateChange': onPlayerStateChange }
    });
}

function onPlayerStateChange(event) {
    const music = document.getElementById('bg-music');
    const toggle = document.getElementById('music-toggle');
    if (event.data == YT.PlayerState.PLAYING) {
        if (music && !music.paused) {
            music.pause();
            if (toggle) toggle.classList.remove('playing');
        }
    }
}

// --- BACKGROUND MUSIC ---
function initMusic() {
    const music = document.getElementById('bg-music');
    const toggle = document.getElementById('music-toggle');
    if (!music || !toggle) return;

    const attemptPlay = () => {
        music.play().then(() => {
            toggle.classList.add('playing');
            removeListeners();
        }).catch(() => {});
    };

    const removeListeners = () => {
        document.removeEventListener('click', attemptPlay);
        document.removeEventListener('touchstart', attemptPlay);
        document.removeEventListener('scroll', attemptPlay);
    };

    document.addEventListener('click', attemptPlay);
    document.addEventListener('touchstart', attemptPlay);
    document.addEventListener('scroll', attemptPlay, { once: true });

    toggle.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (music.paused) {
            music.play();
            toggle.classList.add('playing');
        } else {
            music.pause();
            toggle.classList.remove('playing');
        }
    });
}

// --- COUNTDOWN ---
function updateCountdown() {
    const now = new Date().getTime();
    const distance = WEDDING_DATE - now;

    if (distance < 0) {
        const wrapper = document.querySelector('.countdown-wrapper');
        if (wrapper) wrapper.innerHTML = `<h3 style="color: var(--rose); font-family: 'Cinzel', serif; padding: 10px;">The Wedding is LIVE! 🎉</h3>`;
        return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    const d = document.getElementById('days');
    const h = document.getElementById('hours');
    const m = document.getElementById('minutes');
    const s = document.getElementById('seconds');

    if (d) d.innerText = String(days).padStart(2, '0');
    if (h) h.innerText = String(hours).padStart(2, '0');
    if (m) m.innerText = String(minutes).padStart(2, '0');
    if (s) s.innerText = String(seconds).padStart(2, '0');
}
setInterval(updateCountdown, 1000);
updateCountdown();

// --- SCROLL REVEAL ---
function initScrollReveal() {
    const sr = ScrollReveal({
        origin: 'bottom', distance: '50px',
        duration: 1400, delay: 150,
        reset: false, easing: 'cubic-bezier(0.5, 0, 0, 1)'
    });
    sr.reveal('.reveal', { interval: 200 });
    sr.reveal('.section-title', { origin: 'left', distance: '80px' });
    sr.reveal('.hero-info-item', { interval: 120, scale: 0.9 });
    sr.reveal('.countdown-wrapper', { scale: 0.85, delay: 400 });
    sr.reveal('.hero-actions', { delay: 600, opacity: 0 });
}

// --- FLORAL PETAL ANIMATION ---
function startPetals() {
    const canvas = document.getElementById('petal-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let petals = [];

    const petalShapes = ['🌸', '🌺', '🌼', '🌻', '💮'];
    const emojiPetals = [];

    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    window.addEventListener('resize', resize);
    resize();

    class Petal {
        constructor() { this.reset(); }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = -30;
            this.size = Math.random() * 14 + 8;
            this.speedY = Math.random() * 1.2 + 0.4;
            this.speedX = Math.random() * 0.8 - 0.4;
            this.rotation = Math.random() * 360;
            this.rotSpeed = Math.random() * 1.5 - 0.75;
            this.opacity = Math.random() * 0.5 + 0.3;
            this.color = ['#F2A7C3', '#FFD6E7', '#FFC8DD', '#E8C4D8', '#D4F0D4'][Math.floor(Math.random() * 5)];
        }
        update() {
            this.y += this.speedY;
            this.x += Math.sin(this.y / 60) * 0.6 + this.speedX;
            this.rotation += this.rotSpeed;
            if (this.y > canvas.height + 30) this.reset();
        }
        draw() {
            ctx.save();
            ctx.globalAlpha = this.opacity;
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation * Math.PI / 180);
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, this.size, this.size / 2.2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    for (let i = 0; i < 55; i++) {
        const p = new Petal();
        p.y = Math.random() * canvas.height; // Scatter initially
        petals.push(p);
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        petals.forEach(p => { p.update(); p.draw(); });
        requestAnimationFrame(animate);
    }
    animate();
}

// --- SLIDESHOW ---
function initSlideshow() {
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    const prev = document.querySelector('.ss-prev');
    const next = document.querySelector('.ss-next');
    let current = 0;
    let interval;

    function show(n) {
        slides[current].classList.remove('active');
        dots[current].classList.remove('active');
        current = (n + slides.length) % slides.length;
        slides[current].classList.add('active');
        dots[current].classList.add('active');
    }
    function start() { interval = setInterval(() => show(current + 1), 5000); }
    function reset() { clearInterval(interval); start(); }

    if (prev) prev.addEventListener('click', () => { show(current - 1); reset(); });
    if (next) next.addEventListener('click', () => { show(current + 1); reset(); });
    dots.forEach((dot, i) => dot.addEventListener('click', () => { show(i); reset(); }));
    start();
}

// --- LIGHTBOX ---
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const closeLightbox = document.querySelector('.close-lightbox');
const galleryImgs = document.querySelectorAll('.gallery-img');
const prevBtn = document.getElementById('prev-img');
const nextBtn = document.getElementById('next-img');
let currentIndex = 0;

function updateLightbox(index) {
    if (index < 0) index = galleryImgs.length - 1;
    if (index >= galleryImgs.length) index = 0;
    currentIndex = index;
    if (lightboxImg) lightboxImg.src = galleryImgs[currentIndex].src;
}

galleryImgs.forEach((img, i) => {
    img.addEventListener('click', () => {
        if (lightbox) { lightbox.style.display = 'flex'; }
        updateLightbox(i);
        document.body.style.overflow = 'hidden';
    });
});

if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); updateLightbox(currentIndex - 1); });
if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); updateLightbox(currentIndex + 1); });
if (closeLightbox) closeLightbox.addEventListener('click', () => { lightbox.style.display = 'none'; document.body.style.overflow = 'auto'; });
if (lightbox) {
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) { lightbox.style.display = 'none'; document.body.style.overflow = 'auto'; }
    });
}
document.addEventListener('keydown', (e) => {
    if (lightbox && lightbox.style.display === 'flex') {
        if (e.key === 'ArrowLeft') updateLightbox(currentIndex - 1);
        if (e.key === 'ArrowRight') updateLightbox(currentIndex + 1);
        if (e.key === 'Escape') { lightbox.style.display = 'none'; document.body.style.overflow = 'auto'; }
    }
});

// --- SUPABASE WISHES ---
const wishesForm = document.getElementById('wishes-form');
const wishesList = document.getElementById('wishes-list');
const nameInput = document.getElementById('wish-name');
const messageInput = document.getElementById('wish-message');

async function fetchWishes() {
    if (!wishesList) return;
    const { data, error } = await _supabase
        .from('wishes')
        .select('*')
        .eq('event_id', EVENT_ID)
        .order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    renderWishes(data);
}

function renderWishes(wishes) {
    if (!wishesList) return;
    wishesList.innerHTML = '';
    if (!wishes.length) {
        wishesList.innerHTML = `<p style="text-align:center;color:var(--text-muted);opacity:0.6;padding:20px;">Be the first to send your blessings! 💐</p>`;
        return;
    }
    wishes.forEach(wish => {
        const el = document.createElement('div');
        el.className = 'wish-item';
        el.innerHTML = `
            <h4>${escapeHTML(wish.name)}</h4>
            <p>${escapeHTML(wish.message)}</p>
            <small style="opacity:0.4;font-size:0.68rem;display:block;text-align:right;margin-top:6px;">
                ${new Date(wish.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </small>`;
        wishesList.appendChild(el);
    });
}

if (wishesForm) {
    wishesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        const message = messageInput.value.trim();
        if (!name || !message) return;

        const btn = wishesForm.querySelector('button');
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Sending...';

        const { error } = await _supabase.from('wishes').insert([{ name, message, event_id: EVENT_ID }]);

        if (error) { alert('Error: ' + error.message); }
        else {
            wishesForm.reset();
            btn.innerHTML = 'Blessing Sent! 💐';
            setTimeout(() => { btn.innerHTML = orig; }, 2500);
        }
        btn.disabled = false;
    });
}

_supabase.channel(`public:wishes_${EVENT_ID}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes' }, () => { fetchWishes(); })
    .subscribe();

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

fetchWishes();
