// --- CONFIG ---
const WEDDING_DATE = new Date('April 10, 2026 11:00:00').getTime();
const EVENT_ID = 'vishnu-suharika-reception';
const SUPABASE_URL = 'https://ntjqjmuripwexwlhfrny.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vi_vz9qfKMJnEymw3WaPpg_2A6SeSWR';
let _supabase = null;

if (typeof supabase !== 'undefined') {
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initLoader();
    initScrollReveal();
    initWishes();
    initTimer();
});

// --- LOADER ---
function initLoader() {
    const loader = document.getElementById('loader');
    const hideLoader = () => {
        setTimeout(() => {
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => {
                    loader.style.visibility = 'hidden';
                }, 800);
            }
        }, 1200);
    };

    if (document.readyState === 'complete') {
        hideLoader();
    } else {
        window.addEventListener('load', hideLoader);
    }
}

// --- TIMER ---
function initTimer() {
    function update() {
        const now = new Date().getTime();
        const diff = WEDDING_DATE - now;

        const countdownWrapper = document.querySelector('.countdown-container');
        if (!countdownWrapper) return;

        if (diff <= 0) {
            countdownWrapper.innerHTML = `
                <div style="font-family: 'Playfair Display', serif; color: var(--teal-primary); font-size: 1.5rem; font-weight: 700; letter-spacing: 2px;">
                    <i class="fas fa-circle" style="color: #e74c3c; font-size: 0.8rem; vertical-align: middle; margin-right: 10px;"></i>
                    RECEPTION IS LIVE
                </div>`;
            return;
        }

        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);

        const daysEl = document.getElementById('days');
        const hoursEl = document.getElementById('hours');
        const minutesEl = document.getElementById('minutes');
        const secondsEl = document.getElementById('seconds');

        if (daysEl) daysEl.innerText = d.toString().padStart(2, '0');
        if (hoursEl) hoursEl.innerText = h.toString().padStart(2, '0');
        if (minutesEl) minutesEl.innerText = m.toString().padStart(2, '0');
        if (secondsEl) secondsEl.innerText = s.toString().padStart(2, '0');
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
    const form = document.getElementById('wishes-form');
    const feed = document.getElementById('wishes-feed');
    if (!form || !feed || !_supabase) {
        if (feed) feed.innerHTML = '<p style="text-align:center; opacity:0.3; padding-top:20px;">Wishes are currently unavailable.</p>';
        return;
    }

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
            feed.innerHTML = '<p style="text-align:center; opacity:0.3; padding-top:20px; font-size: 0.7rem; letter-spacing: 2px;">BE THE FIRST TO BLESS THE COUPLE.</p>';
            return;
        }
        feed.innerHTML = wishes.map(w => `
            <div class="wish-item">
                <h4>${escapeHTML(w.name)}</h4>
                <p>${escapeHTML(w.message)}</p>
            </div>
        `).join('');
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('wish-name').value.trim();
        const message = document.getElementById('wish-message').value.trim();
        const btn = form.querySelector('button');

        if (!name || !message) return;

        btn.disabled = true;
        const originalText = btn.innerHTML;
        btn.innerHTML = 'SENDING...';

        const { error } = await _supabase
            .from('wishes')
            .insert([{ name, message, event_id: EVENT_ID }]);

        if (error) {
            alert('Error sending: ' + error.message);
        } else {
            form.reset();
            btn.innerHTML = 'THANK YOU! ❤️';
            fetchWishes();
            setTimeout(() => { btn.innerHTML = originalText; }, 3000);
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
