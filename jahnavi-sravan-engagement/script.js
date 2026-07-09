// Countdown target: 9th July 2026, 10:00 AM IST
const LIVE_START = new Date('2026-07-09T10:00:00+05:30').getTime();

function pad(n) {
    return String(n).padStart(2, '0');
}

let countdownInterval = null;

function updateCountdown() {
    const now = Date.now();
    const distance = LIVE_START - now;
    const wrap = document.getElementById('countdown-wrapper');
    const statusBadge = document.getElementById('live-status');

    if (distance <= 0) {
        if (wrap) wrap.style.display = 'none';
        if (statusBadge) {
            statusBadge.innerHTML = '<span class="pulse"></span> LIVE NOW';
        }
        if (countdownInterval) clearInterval(countdownInterval);
        return;
    }

    const days = Math.floor(distance / 86400000);
    const hours = Math.floor((distance % 86400000) / 3600000);
    const minutes = Math.floor((distance % 3600000) / 60000);
    const seconds = Math.floor((distance % 60000) / 1000);

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = pad(val);
    };

    set('days', days);
    set('hours', hours);
    set('minutes', minutes);
    set('seconds', seconds);
}

updateCountdown();
countdownInterval = setInterval(updateCountdown, 1000);

function hideLoader() {
    const loader = document.getElementById('loader');
    if (!loader || loader.dataset.hidden) return;
    loader.dataset.hidden = '1';
    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => { loader.style.display = 'none'; }, 500);
    }, 800);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideLoader);
} else {
    hideLoader();
}
// Fallback — don't wait for slow iframes (YouTube/Maps can block window.load)
setTimeout(hideLoader, 2500);
