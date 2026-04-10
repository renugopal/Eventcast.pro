// --- CONFIG ---
const EVENT_ID = 'suharika-vishnu-wedding-botanical';
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
            feed.innerHTML = '<p style="text-align:center; opacity:0.3; padding-top:20px;">BE THE FIRST TO BLISS THE COUPLE.</p>';
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
        btn.textContent = 'SENDING...';

        const { error } = await _supabase
            .from('wishes')
            .insert([{ name, message, event_id: EVENT_ID }]);

        if (error) {
            alert('Error sending: ' + error.message);
        } else {
            form.reset();
            btn.textContent = 'THANK YOU!';
            fetchWishes();
            setTimeout(() => { btn.textContent = 'Send Blessing'; }, 3000);
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
