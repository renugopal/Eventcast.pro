// Event Data
const events = [
    {
        name: "Mangala Snanam",
        date: "April 11, 2026 18:15:00",
        youtubeId: "9WO1Wg3glsg", // Updated Link
        badge: "Mangala Snanam Live Stream"
    },
    {
        name: "Half Saree Ceremony",
        date: "April 12, 2026 10:30:00",
        youtubeId: "nYl-_wgr01s", // Updated Link
        badge: "Half Saree Ceremony Live Stream"
    }
];

// Loader
window.addEventListener('load', () => {
    setTimeout(() => {
        document.querySelector('.loader').style.opacity = '0';
        setTimeout(() => {
            document.querySelector('.loader').style.display = 'none';
        }, 500);
    }, 1500);

    startPetals();
});

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

// Countdown Logic
function updateCountdown() {
    const now = new Date().getTime();
    let currentEvent = events[0];
    let target = new Date(events[0].date).getTime();

    // If Mangala Snanam is over (midnight transition)
    const midnightAfterEvent1 = new Date("April 12, 2026 00:00:00").getTime();
    
    if (now > midnightAfterEvent1) {
        currentEvent = events[1];
        target = new Date(events[1].date).getTime();
        const title = document.getElementById('countdown-title');
        if (title) title.innerText = "Main Ceremony Starts In";
        
        // Auto-switch UI tabs if needed
        if (!document.getElementById('btn-event2').classList.contains('active') && !window.userInteractedWithTabs) {
            updateVideo(1);
        }
    } else {
        const title = document.getElementById('countdown-title');
        if (title) title.innerText = "Mangala Snanam Starts In";
        
        // Auto-switch UI tabs if needed
        if (!document.getElementById('btn-event1').classList.contains('active') && !window.userInteractedWithTabs) {
            updateVideo(0);
        }
    }

    const diff = target - now;

    if (diff > 0) {
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);

        const dEl = document.getElementById('days');
        const hEl = document.getElementById('hours');
        const mEl = document.getElementById('minutes');
        const sEl = document.getElementById('seconds');

        if (dEl) dEl.innerText = d.toString().padStart(2, '0');
        if (hEl) hEl.innerText = h.toString().padStart(2, '0');
        if (mEl) mEl.innerText = m.toString().padStart(2, '0');
        if (sEl) sEl.innerText = s.toString().padStart(2, '0');
    } else {
        const cd = document.getElementById('countdown');
        if (cd) cd.innerHTML = "<div class='live-now'>EVENT IS LIVE NOW!</div>";
    }
}

// Video Switcher
function updateVideo(index) {
    const event = events[index];
    const iframe = document.querySelector('#video-frame iframe');
    if (iframe) iframe.src = `https://www.youtube.com/embed/${event.youtubeId}`;
    const badge = document.getElementById('event-badge');
    if (badge) badge.innerText = event.badge;
    
    // Update active button
    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
        if(i === index) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

// Button Click Listeners
window.userInteractedWithTabs = false;
const btn1 = document.getElementById('btn-event1');
const btn2 = document.getElementById('btn-event2');

if (btn1) {
    btn1.addEventListener('click', () => {
        window.userInteractedWithTabs = true;
        updateVideo(0);
    });
}
if (btn2) {
    btn2.addEventListener('click', () => {
        window.userInteractedWithTabs = true;
        updateVideo(1);
    });
}

// Initialize
updateVideo(0); // Load first video initially just in case
setInterval(updateCountdown, 1000);
updateCountdown();

// Scroll Reveal
ScrollReveal().reveal('.reveal', {
    delay: 200,
    distance: '50px',
    duration: 1000,
    origin: 'bottom',
    interval: 100
});
