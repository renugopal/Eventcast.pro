document.addEventListener('DOMContentLoaded', () => {

    /* ===================================================
       1. COUNTDOWN TIMER
       =================================================== */
    const targetDate = new Date('2026-04-01T06:30:00+05:30').getTime();

    const daysEl = document.getElementById('cd-days');
    const hoursEl = document.getElementById('cd-hours');
    const minutesEl = document.getElementById('cd-minutes');
    const secondsEl = document.getElementById('cd-seconds');

    const timerContainer = document.getElementById('countdown-timer');
    const liveMessage = document.getElementById('countdown-live');
    const streamStatus = document.getElementById('livestream-status');

    function updateCountdown() {
        const now = Date.now();
        const distance = targetDate - now;

        if (distance < 0) {
            // Live stream has started
            if (timerContainer) timerContainer.classList.add('hidden');
            if (liveMessage) liveMessage.classList.remove('hidden');

            if (streamStatus) {
                streamStatus.textContent = '🔴 Live Now';
                streamStatus.classList.add('live');
            }
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        daysEl.textContent = days;
        hoursEl.textContent = hours.toString().padStart(2, '0');
        minutesEl.textContent = minutes.toString().padStart(2, '0');
        secondsEl.textContent = seconds.toString().padStart(2, '0');
    }

    updateCountdown();
    setInterval(updateCountdown, 1000);


    /* ===================================================
       2. SCROLL FADE-IN ANIMATIONS (Intersection Observer)
       =================================================== */
    const faders = document.querySelectorAll('.fade-in');
    const appearOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const appearOnScroll = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        });
    }, appearOptions);

    faders.forEach(fader => appearOnScroll.observe(fader));


    /* ===================================================
       3. SIDE NAVIGATION DOTS
       =================================================== */
    const navDots = document.querySelectorAll('.nav-dot');
    const sections = document.querySelectorAll('.full-section');

    // Click to scroll to section
    navDots.forEach(dot => {
        dot.addEventListener('click', () => {
            const targetId = dot.getAttribute('data-target');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

    // Update active dot on scroll
    const sectionObserverOptions = {
        threshold: 0.4
    };

    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const id = entry.target.getAttribute('id');
                navDots.forEach(dot => {
                    dot.classList.toggle('active', dot.getAttribute('data-target') === id);
                });
            }
        });
    }, sectionObserverOptions);

    sections.forEach(section => sectionObserver.observe(section));


    /* ===================================================
       4. GUEST WISHES / CHAT (localStorage)
       =================================================== */
    const WISHES_STORAGE_KEY = 'wedding_wishes_gc_samyuktha';
    const wishForm = document.getElementById('wishes-form');
    const wishNameInput = document.getElementById('wish-name');
    const wishMessageInput = document.getElementById('wish-message');
    const wishesList = document.getElementById('wishes-list');
    const wishesEmpty = document.getElementById('wishes-empty');
    const wishesCount = document.getElementById('wishes-count');

    // Load wishes from localStorage
    function loadWishes() {
        try {
            const stored = localStorage.getItem(WISHES_STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    }

    // Save wishes to localStorage
    function saveWishes(wishes) {
        try {
            localStorage.setItem(WISHES_STORAGE_KEY, JSON.stringify(wishes));
        } catch {
            // Storage full or unavailable — fail silently
        }
    }

    // Format timestamp
    function formatTime(timestamp) {
        const date = new Date(timestamp);
        const options = {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        };
        return date.toLocaleString('en-IN', options);
    }

    // Render a single wish card
    function createWishCard(wish) {
        const card = document.createElement('div');
        card.className = 'wish-card';

        card.innerHTML = `
            <div class="wish-name">${escapeHtml(wish.name)}</div>
            <div class="wish-message">${escapeHtml(wish.message)}</div>
            <div class="wish-time">${formatTime(wish.timestamp)}</div>
        `;

        return card;
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Render all wishes
    function renderWishes() {
        const wishes = loadWishes();

        // Update count
        if (wishes.length > 0) {
            wishesCount.textContent = `${wishes.length} wish${wishes.length !== 1 ? 'es' : ''} sent`;
            wishesEmpty.classList.add('hidden');
        } else {
            wishesCount.textContent = '';
            wishesEmpty.classList.remove('hidden');
        }

        // Clear existing cards (keep empty message element)
        const existingCards = wishesList.querySelectorAll('.wish-card');
        existingCards.forEach(card => card.remove());

        // Render newest first
        wishes.reverse().forEach(wish => {
            wishesList.appendChild(createWishCard(wish));
        });
    }

    // Handle form submission
    if (wishForm) {
        wishForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const name = wishNameInput.value.trim();
            const message = wishMessageInput.value.trim();

            if (!name || !message) return;

            const wish = {
                name,
                message,
                timestamp: Date.now()
            };

            const wishes = loadWishes();
            wishes.push(wish);
            saveWishes(wishes);

            // Clear form
            wishNameInput.value = '';
            wishMessageInput.value = '';

            // Re-render
            renderWishes();

            // Scroll to top of wishes list to show new message
            wishesList.scrollTop = 0;
        });
    }

    // Initial render
    renderWishes();


    /* ===================================================
       5. PHOTO GALLERY + LIGHTBOX
       =================================================== */
    const photoGallery = document.getElementById('photo-gallery');

    // Configure photo filenames here
    const photoList = [
        'photo1.jpeg', 'photo2.jpeg', 'photo3.jpeg', 'photo4.jpeg',
        'photo5.jpeg', 'photo6.jpeg', 'photo7.jpeg', 'photo8.jpeg'
    ];

    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.getElementById('lightbox-close');
    const lightboxPrev = document.getElementById('lightbox-prev');
    const lightboxNext = document.getElementById('lightbox-next');
    let currentLightboxIndex = 0;

    if (photoGallery) {
        photoList.forEach((filename, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'gallery-item';

            const img = document.createElement('img');
            img.src = filename;
            img.alt = `Wedding Moment ${index + 1}`;
            img.setAttribute('loading', 'lazy');

            // Fade-in on load
            img.style.opacity = '0';
            img.onload = () => {
                img.style.transition = 'opacity 0.8s ease';
                img.style.opacity = '1';
            };

            // Open lightbox on click
            itemDiv.addEventListener('click', () => openLightbox(index));

            itemDiv.appendChild(img);
            photoGallery.appendChild(itemDiv);
        });
    }

    function openLightbox(index) {
        currentLightboxIndex = index;
        lightboxImg.src = photoList[index];
        lightboxModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightboxModal.classList.remove('active');
        document.body.style.overflow = '';
    }

    function navigateLightbox(direction) {
        currentLightboxIndex = (currentLightboxIndex + direction + photoList.length) % photoList.length;
        lightboxImg.style.opacity = '0';
        setTimeout(() => {
            lightboxImg.src = photoList[currentLightboxIndex];
            lightboxImg.style.opacity = '1';
        }, 200);
    }

    if (lightboxClose) {
        lightboxClose.addEventListener('click', closeLightbox);
    }

    if (lightboxPrev) {
        lightboxPrev.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateLightbox(-1);
        });
    }

    if (lightboxNext) {
        lightboxNext.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateLightbox(1);
        });
    }

    if (lightboxModal) {
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) closeLightbox();
        });
    }

    // Keyboard navigation for lightbox
    document.addEventListener('keydown', (e) => {
        if (!lightboxModal.classList.contains('active')) return;

        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
    });

    // Touch/swipe support for lightbox
    let touchStartX = 0;
    let touchEndX = 0;

    lightboxModal.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    lightboxModal.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const swipeDistance = touchStartX - touchEndX;

        if (Math.abs(swipeDistance) > 60) {
            if (swipeDistance > 0) navigateLightbox(1);  // Swipe left → next
            else navigateLightbox(-1);                    // Swipe right → prev
        }
    }, { passive: true });

});
