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
       4. GUEST WISHES / CHAT (Supabase)
       =================================================== */
    const SUPABASE_URL = 'https://ntjqjmuripwexwlhfrny.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_vi_vz9qfKMJnEymw3WaPpg_2A6SeSWR';
    const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // IMPORTANT: Change this ID for every new project you create from this template
    const EVENT_ID = 'TEMPLATE_EVENT_ID'; 

    const wishForm = document.getElementById('wishes-form');
    const wishNameInput = document.getElementById('wish-name');
    const wishMessageInput = document.getElementById('wish-message');
    const wishesList = document.getElementById('wishes-list');
    const wishesEmpty = document.getElementById('wishes-empty');
    const wishesCount = document.getElementById('wishes-count');

    // Fetch Existing Wishes
    async function fetchWishes() {
        const { data, error } = await _supabase
            .from('wishes')
            .select('*')
            .eq('event_id', EVENT_ID)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching wishes:', error);
            return;
        }
        renderWishes(data);
    }

    // Render Wishes
    function renderWishes(wishes) {
        // Update count
        if (wishes.length > 0) {
            wishesCount.textContent = `${wishes.length} wish${wishes.length !== 1 ? 'es' : ''} sent`;
            wishesEmpty.classList.add('hidden');
        } else {
            wishesCount.textContent = '';
            wishesEmpty.classList.remove('hidden');
        }

        // Clear existing cards
        const existingCards = wishesList.querySelectorAll('.wish-card');
        existingCards.forEach(card => card.remove());

        // Render newest first
        wishes.forEach(wish => {
            const card = document.createElement('div');
            card.className = 'wish-card';
            card.innerHTML = `
                <div class="wish-name">${escapeHtml(wish.name)}</div>
                <div class="wish-message">${escapeHtml(wish.message)}</div>
                <div class="wish-time">${new Date(wish.created_at).toLocaleString('en-IN', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}</div>
            `;
            wishesList.appendChild(card);
        });
    }

    // Handle Form Submission
    if (wishForm) {
        wishForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = wishNameInput.value.trim();
            const message = wishMessageInput.value.trim();
            if (!name || !message) return;

            const btn = wishForm.querySelector('button');
            btn.disabled = true;
            btn.textContent = 'Sending...';

            const { error } = await _supabase
                .from('wishes')
                .insert([{ name, message, event_id: EVENT_ID }]);

            if (error) {
                alert('Error: ' + error.message);
            } else {
                wishNameInput.value = '';
                wishMessageInput.value = '';
                fetchWishes(); // Refresh
            }
            btn.disabled = false;
            btn.textContent = 'Send Wishes ✨';
        });
    }

    // Real-time Subscription
    _supabase.channel('public:wishes_template')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes' }, payload => {
            if (payload.new.event_id === EVENT_ID) fetchWishes();
        }).subscribe();

    // Escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Initial load
    fetchWishes();


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
