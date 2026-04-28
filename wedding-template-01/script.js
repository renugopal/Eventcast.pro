// --- CONFIG DRIVEN LOGIC ---
// These values should be provided by config.js
const CONFIG = window.WEDDING_CONFIG || {
    groom: "Arjun",
    bride: "Nithya",
    date: "Saturday, April 25",
    time: "03:06 AM",
    timeSubtext: "(Early Hours of Sunday)",
    timerTarget: "2026-04-25T03:06:00",
    venue: "Sri Prasannanjaneya Swamy Vari Kalyanamandapam",
    venueSubtext: "Boppudi Village",
    youtubeId: "jfKfPfyJRdk",
    invitationVideo: "assets/invitation.mp4",
    thumbnail: "assets/thumb.jpeg",
    gallery: ["assets/gallery_1.png", "assets/gallery_2.png", "assets/gallery_3.png", "assets/gallery_4.png"],
    supabaseUrl: 'https://ntjqjmuripwexwlhfrny.supabase.co',
    supabaseKey: 'sb_publishable_vi_vz9qfKMJnEymw3WaPpg_2A6SeSWR',
    eventId: 'arjun-nithya'
};

const WEDDING_DATE = new Date(CONFIG.timerTarget).getTime();

// --- CLOUDINARY OPTIMIZATION ---
const optimizeUrl = (url) => {
    if (!url || !url.includes('cloudinary.com')) return url;
    if (url.includes('/upload/')) {
        return url.replace('/upload/', '/upload/f_auto,q_auto/');
    }
    return url;
};

// --- UI INJECTION ---
document.addEventListener('DOMContentLoaded', () => {
    // Inject names and titles
    const initials = CONFIG.groom ? `${CONFIG.groom[0]} & ${CONFIG.bride[0]}` : CONFIG.bride[0];
    document.querySelectorAll('.logo-text, .initials').forEach(el => el.innerText = initials);
    
    if (document.querySelector('.first-name')) document.querySelector('.first-name').innerText = CONFIG.groom || CONFIG.bride;
    if (document.querySelector('.second-name')) document.querySelector('.second-name').innerText = CONFIG.bride && CONFIG.groom ? CONFIG.bride : "";

    // Inject Intro & Titles
    if (CONFIG.introText && document.querySelector('.intro-text')) {
        document.querySelector('.intro-text').innerText = CONFIG.introText;
    }
    
    if (CONFIG.eventType && document.querySelector('.section-title')) {
        // Find the main greeting title (usually "Wedding Invitation" or similar)
        document.querySelectorAll('h1, .hero-title').forEach(el => {
            if (el.innerText.toLowerCase().includes('wedding')) {
                el.innerText = el.innerText.replace(/wedding/gi, CONFIG.eventType);
            }
        });
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

            // 1. Increment total view count in events table
            const { data: eventData } = await _supabase
                .from('events')
                .select('view_count')
                .eq('id', CONFIG.eventId)
                .single();
            
            const newCount = (eventData?.view_count || 0) + 1;
            await _supabase
                .from('events')
                .update({ view_count: newCount })
                .eq('id', CONFIG.eventId);

            // Update UI
            const viewsDisplay = document.getElementById('total-views-display');
            if (viewsDisplay) viewsDisplay.innerText = newCount.toLocaleString();

            // 2. Insert detailed view into page_views table
            await _supabase
                .from('page_views')
                .insert([{
                    event_id: CONFIG.eventId,
                    device_type: deviceType,
                    referrer: referrer,
                    user_agent: userAgent
                }]);

        } catch (e) { console.error("Analytics error:", e); }
    };
    trackPageView();
    
    // Inject Info
    const infoItems = document.querySelectorAll('.info-text');
    if (infoItems[0]) infoItems[0].innerText = CONFIG.date;
    if (infoItems[1]) infoItems[1].innerText = CONFIG.time;
    if (infoItems[2]) infoItems[2].innerText = CONFIG.venue;
    
    const subtexts = document.querySelectorAll('.info-subtext');
    if (subtexts[0]) subtexts[0].innerText = CONFIG.timeSubtext;
    if (subtexts[1]) subtexts[1].innerText = CONFIG.venueSubtext;

    // Inject Media
    const invVideo = document.querySelector('.invitation-video');
    if (invVideo) {
        invVideo.setAttribute('poster', optimizeUrl(CONFIG.thumbnail));
        invVideo.querySelector('source').setAttribute('src', CONFIG.invitationVideo);
        invVideo.load();
    }

    // Dynamic Gallery
    const slideshowWrapper = document.querySelector('.slideshow-wrapper');
    const dotsContainer = document.querySelector('.ss-dots');
    if (slideshowWrapper && CONFIG.gallery && CONFIG.gallery.length > 0) {
        slideshowWrapper.innerHTML = CONFIG.gallery.map((url, i) => `
            <div class="slide ${i === 0 ? 'active' : ''}">
                <div class="slide-bg" style="background-image: url('${optimizeUrl(url)}');"></div>
                <img src="${optimizeUrl(url)}" alt="Memory ${i+1}" class="gallery-img">
            </div>
        `).join('');
        
        if (dotsContainer) {
            dotsContainer.innerHTML = CONFIG.gallery.map((_, i) => `
                <span class="dot ${i === 0 ? 'active' : ''}"></span>
            `).join('');
        }
    }

    // Photographer Credit
    const logo = document.querySelector('.photographer-section img');
    const name = document.querySelector('.studio-name');
    const phone = document.querySelector('.p-phone');
    const insta = document.querySelector('.p-insta');

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
        const contactInfo = document.querySelector('.contact-info');
        if (contactInfo) {
            // Keep public stats visible if it's there
        }
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

// --- YOUTUBE PLAYER API ---
var ytScriptTag = document.createElement('script');
ytScriptTag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(ytScriptTag, firstScriptTag);

let player;
function onYouTubeIframeAPIReady() {
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

// --- SUPABASE WISHES LOGIC ---
const _supabase = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

const wishesForm = document.getElementById('wishes-form');
const wishesList = document.getElementById('wishes-list');
const nameInput = document.getElementById('wish-name');
const messageInput = document.getElementById('wish-message');

async function fetchWishes() {
    if (!wishesList) return;
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
        if (!name || !message) return;

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

_supabase.channel(`public:wishes_${CONFIG.eventId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes' }, payload => {
        fetchWishes();
    }).subscribe();

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
