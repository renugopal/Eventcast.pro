// --- CONFIG ---
const WEDDING_DATE = new Date('January 1, 2030 00:00:00').getTime();

const STREAMS = {
    day1: "https://www.youtube.com/embed/hnkKBOl9EB4",
    day2: "https://www.youtube.com/embed/dbYxRmqOJ24"
};

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
    autoSetStream();
});

// --- STREAM SWITCH LOGIC ---
function switchStream(day) {
    const iframe = document.getElementById('stream-iframe');
    const btn1 = document.getElementById('btn-day1');
    const btn2 = document.getElementById('btn-day2');

    if (!iframe || !btn1 || !btn2) return;

    iframe.src = STREAMS[day];

    if (day === 'day1') {
        btn1.style.background = "var(--gold)";
        btn1.style.color = "white";
        btn2.style.background = "transparent";
        btn2.style.color = "var(--gold)";
    } else {
        btn2.style.background = "var(--gold)";
        btn2.style.color = "white";
        btn1.style.background = "transparent";
        btn1.style.color = "var(--gold)";
    }
}

function autoSetStream() {
    // Determine the date to switch (April 11, 2026)
    const switchDate = new Date('April 11, 2026 00:00:00').getTime();
    const now = new Date().getTime();

    if (now >= switchDate) {
        switchStream('day2');
    } else {
        switchStream('day1');
    }
}

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
}

// --- FALLING PETALS ANIMATION ---
function startPetals() {
    const canvas = document.getElementById('petal-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const petalImg = new Image();
    petalImg.src = 'petal.webp';
    const leafImg = new Image();
    leafImg.src = 'leaf.webp';
    const images = [petalImg, leafImg];

    let petalsArray = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    window.addEventListener('resize', resize);
    resize();

    class Petal {
        constructor() {
            this.img = images[Math.floor(Math.random() * images.length)];
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height - canvas.height;
            this.size = Math.random() * 15 + 10;
            this.speedX = Math.random() * 1 - 0.5;
            this.speedY = Math.random() * 1 + 0.5;
            this.rotation = Math.random() * 360;
            this.rotationSpeed = Math.random() * 1 - 0.5;
            this.opacity = Math.random() * 0.5 + 0.3;
        }

        update() {
            this.y += this.speedY;
            this.x += Math.sin(this.y / 50) * 0.5;
            this.rotation += this.rotationSpeed;
            if (this.y > canvas.height) {
                this.y = -30;
                this.x = Math.random() * canvas.width;
            }
        }

        draw() {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation * Math.PI / 180);
            ctx.globalAlpha = this.opacity;
            ctx.drawImage(this.img, -this.size / 2, -this.size / 2, this.size, this.size);
            ctx.restore();
        }
    }

    for (let i = 0; i < 40; i++) {
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
    if (!wishesList) return;
    const { data, error } = await _supabase
        .from('wishes')
        .select('*')
        .eq('event_id', 'sandhya-gopi')
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
            .insert([{ name, message, event_id: 'sandhya-gopi' }]);

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
_supabase.channel('public:wishes_sandhya_gopi')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes' }, payload => {
        fetchWishes();
    }).subscribe();

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

fetchWishes();
