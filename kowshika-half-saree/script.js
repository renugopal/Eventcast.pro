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
});

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
        document.getElementById('countdown-title').innerText = "Main Ceremony Starts In";
        
        // Auto-switch UI tabs if needed
        if (!document.getElementById('btn-event2').classList.contains('active') && !window.userInteractedWithTabs) {
            updateVideo(1);
        }
    } else {
        document.getElementById('countdown-title').innerText = "Mangala Snanam Starts In";
        
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

        document.getElementById('days').innerText = d.toString().padStart(2, '0');
        document.getElementById('hours').innerText = h.toString().padStart(2, '0');
        document.getElementById('minutes').innerText = m.toString().padStart(2, '0');
        document.getElementById('seconds').innerText = s.toString().padStart(2, '0');
    } else {
        document.getElementById('countdown').innerHTML = "<div class='live-now'>EVENT IS LIVE NOW!</div>";
    }
}

// Video Switcher
function updateVideo(index) {
    const event = events[index];
    const iframe = document.querySelector('#video-frame iframe');
    iframe.src = `https://www.youtube.com/embed/${event.youtubeId}`;
    document.getElementById('event-badge').innerText = event.badge;
    
    // Update active button
    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
        if(i === index) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

// Button Click Listeners
window.userInteractedWithTabs = false;
document.getElementById('btn-event1').addEventListener('click', () => {
    window.userInteractedWithTabs = true;
    updateVideo(0);
});
document.getElementById('btn-event2').addEventListener('click', () => {
    window.userInteractedWithTabs = true;
    updateVideo(1);
});

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
