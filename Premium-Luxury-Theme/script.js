// --- CONFIG ---
const WEDDING_DATE = new Date('December 15, 2026 16:00:00').getTime();
const EVENT_ID = 'sarah-michael-luxury';
const SUPABASE_URL = 'https://ntjqjmuripwexwlhfrny.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vi_vz9qfKMJnEymw3WaPpg_2A6SeSWR';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initLoader();
    initGoldDust();
    initTimer();
    initScrollReveal();
    initWishes();
});

// --- LOADER ---
function initLoader() {
    const loader = document.getElementById('luxury-loader');
    window.addEventListener('load', () => {
        setTimeout(() => {
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.style.visibility = 'hidden';
            }, 800);
        }, 1500);
    });
}

// --- GOLD DUST (CANVAS) ---
function initGoldDust() {
    const canvas = document.getElementById('dust-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    window.addEventListener('resize', resize);
    resize();

    class Particle {
        constructor() {
            this.init();
        }

        init() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2 + 0.5;
            this.speedY = Math.random() * 0.5 + 0.2; // Slowly drifting up
            this.speedX = (Math.random() - 0.5) * 0.3;
            this.opacity = Math.random() * 0.5 + 0.1;
            this.flicker = Math.random() * 0.05;
        }

        update() {
            this.y -= this.speedY;
            this.x += this.speedX;
            this.opacity += (Math.random() - 0.5) * 0.02;
            
            if (this.y < -10) {
                this.y = canvas.height + 10;
                this.x = Math.random() * canvas.width;
            }
            if (this.x < -10) this.x = canvas.width + 10;
            if (this.x > canvas.width + 10) this.x = -10;
            
            this.opacity = Math.max(0.1, Math.min(0.6, this.opacity));
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(212, 175, 55, ${this.opacity})`;
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(212, 175, 55, 0.5)';
            ctx.fill();
        }
    }

    for (let i = 0; i < 80; i++) {
        particles.push(new Particle());
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.update();
            p.draw();
        });
        requestAnimationFrame(animate);
    }

    animate();
}

// --- TIMER ---
function initTimer() {
    function update() {
        const now = new Date().getTime();
        const diff = WEDDING_DATE - now;

        if (diff <= 0) {
            document.querySelector('.countdown-pill').innerHTML = '<div class="live-ribbon">WEDDING IS LIVE</div>';
            return;
        }

        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);

        document.getElementById('days').innerText = d.toString().padStart(2, '0');
        document.getElementById('hours').innerText = h.toString().padStart(2, '0');
        document.getElementById('minutes').innerText = m.toString().padStart(2, '0');
        document.getElementById('seconds').innerText = s.toString().padStart(2, '0');
    }

    setInterval(update, 1000);
    update();
}

// --- SCROLL REVEAL ---
function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    reveals.forEach(el => observer.observe(el));
}

// --- WISHES ---
function initWishes() {
    const form = document.getElementById('wishes-form-noir');
    const wall = document.getElementById('wishes-wall-container');
    if (!form || !wall) return;

    const fetchWishes = async () => {
        const { data, error } = await _supabase
            .from('wishes')
            .select('*')
            .eq('event_id', EVENT_ID)
            .order('created_at', { ascending: false });

        if (!error) renderWishes(data);
    };

    const renderWishes = (wishes) => {
        if (!wishes || wishes.length === 0) {
            wall.innerHTML = '<p class="text-xs opacity-30 text-center py-10">BE THE FIRST TO SEND A BLESSING.</p>';
            return;
        }
        wall.innerHTML = wishes.map(w => `
            <div class="wish-card-noir">
                <h5>${escapeHTML(w.name)}</h5>
                <p class="text-sm opacity-60">${escapeHTML(w.message)}</p>
                <div class="flex justify-between items-center mt-4">
                    <span class="text-[0.6rem] tracking-[2px] text-gold-foil opacity-40 uppercase">
                        ${new Date(w.created_at).toLocaleDateString()}
                    </span>
                </div>
            </div>
        `).join('');
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('wish-name').value.trim();
        const message = document.getElementById('wish-message').value.trim();
        const btn = form.querySelector('button');

        btn.disabled = true;
        btn.innerHTML = 'SENDING...';

        const { error } = await _supabase
            .from('wishes')
            .insert([{ name, message, event_id: EVENT_ID }]);

        if (error) {
            alert('Error sending: ' + error.message);
        } else {
            form.reset();
            btn.innerHTML = 'SENT WITH LOVE';
            fetchWishes();
            setTimeout(() => { btn.innerHTML = 'SEND BLESSING <i class="fa-solid fa-arrow-right-long"></i>'; }, 3000);
        }
        btn.disabled = false;
    });

    _supabase.channel(`public:wishes:${EVENT_ID}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes', filter: `event_id=eq.${EVENT_ID}` }, () => {
            fetchWishes();
        }).subscribe();

    fetchWishes();

    function escapeHTML(str) {
        const p = document.createElement('p');
        p.textContent = str;
        return p.innerHTML;
    }
}
