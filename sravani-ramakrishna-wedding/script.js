// --- CONFIG ---
const WEDDING_DATE = new Date('April 3, 2026 19:00:00').getTime();

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
});

// --- COUNTDOWN TIMER ---
function updateCountdown() {
    const now = new Date().getTime();
    const distance = WEDDING_DATE - now;

    if (distance < 0) {
        document.querySelector('.countdown-wrapper').innerHTML = `<h3 style="color: var(--gold); font-family: 'Cinzel', serif;">The Wedding is LIVE! 🎉</h3>`;
        return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    document.getElementById('days').innerText = days.toString().padStart(2, '0');
    document.getElementById('hours').innerText = hours.toString().padStart(2, '0');
    document.getElementById('minutes').innerText = minutes.toString().padStart(2, '0');
    document.getElementById('seconds').innerText = seconds.toString().padStart(2, '0');
}

setInterval(updateCountdown, 1000);
updateCountdown();

// --- SCROLL REVEAL ---
function initScrollReveal() {
    const sr = ScrollReveal({
        origin: 'bottom',
        distance: '60px',
        duration: 1500,
        delay: 200,
        reset: false
    });

    sr.reveal('.reveal', { interval: 200 });
    sr.reveal('.couple-names', { origin: 'top', delay: 500 });
    sr.reveal('.date-venue', { delay: 700 });
    sr.reveal('.countdown-wrapper', { scale: 0.8, delay: 900 });
}

// --- FALLING PETALS ANIMATION ---
function startPetals() {
    const canvas = document.getElementById('petal-canvas');
    const ctx = canvas.getContext('2d');

    let petalsArray = [];
    const petalColors = ['#FADADD', '#FFF0F5', '#FFC0CB', '#E0F2F1']; // Soft pink and mint

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

    for (let i = 0; i < 50; i++) {
        petalsArray.push(new Petal());
    }

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
const SUPABASE_URL = 'https://ntjqjmuripwexwlhfrny.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vi_vz9qfKMJnEymw3WaPpg_2A6SeSWR';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const wishesForm = document.getElementById('wishes-form');
const wishesList = document.getElementById('wishes-list');
const nameInput = document.getElementById('wish-name');
const messageInput = document.getElementById('wish-message');

async function fetchWishes() {
    const { data, error } = await _supabase
        .from('wishes')
        .select('*')
        .eq('event_id', 'sravani-ramakrishna')
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
                ${new Date(wish.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
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
            .insert([{ name, message, event_id: 'sravani-ramakrishna' }]);

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

// Real-time
_supabase.channel('public:wishes_sravani')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes' }, payload => {
        fetchWishes();
    }).subscribe();

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

fetchWishes();

// --- INITIAL CONGRATS CONFETTI ---
// Simple implementation avoiding external library for now
function triggerCelebration() {
    // Add logic here if needed or use a small library
}
