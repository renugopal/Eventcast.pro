document.addEventListener('DOMContentLoaded', () => {

    /* --- Countdown Logic --- */
    // Target Date: April 1, 2026, 06:30:00 IST (UTC+5:30)
    const targetDate = new Date('2026-04-01T06:30:00+05:30').getTime();
    
    const daysEl = document.getElementById('cd-days');
    const hoursEl = document.getElementById('cd-hours');
    const minutesEl = document.getElementById('cd-minutes');
    const secondsEl = document.getElementById('cd-seconds');
    
    const timerContainer = document.getElementById('countdown-timer');
    const liveMessage = document.getElementById('countdown-live');
    const streamStatus = document.getElementById('livestream-status');
    
    function updateCountdown() {
        const now = new Date().getTime();
        const distance = targetDate - now;
        
        if (distance < 0) {
            // Live Stream has started
            if (timerContainer) timerContainer.classList.add('hidden');
            if (liveMessage) liveMessage.classList.remove('hidden');
            
            // Update status badge
            if (streamStatus) {
                streamStatus.textContent = 'Live Now 🎉';
                streamStatus.style.background = '#e74c3c'; // Red for live
                streamStatus.style.animation = 'pulse 1s infinite';
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
    
    // Initial call and set interval
    updateCountdown();
    setInterval(updateCountdown, 1000);

    /* --- Scroll Animations (Standard Intersection Observer) --- */
    const faders = document.querySelectorAll('.fade-in');
    const appearOptions = {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    };

    const appearOnScroll = new IntersectionObserver(function(entries, observer) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        });
    }, appearOptions);

    faders.forEach(fader => {
        appearOnScroll.observe(fader);
    });

    /* --- Dynamic Photo Gallery --- */
    const photoGallery = document.getElementById('photo-gallery');
    
    // USER: Please upload your wedding photos to the 'wedding/' folder 
    // and name them photo1.jpeg to photo9.jpeg.
    const photoList = [
        "photo1.jpeg", "photo2.jpeg", "photo3.jpeg",
        "photo4.jpeg", "photo5.jpeg", "photo6.jpeg",
        "photo7.jpeg", "photo8.jpeg", "photo9.jpeg"
    ];

    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.querySelector('.lightbox-close');

    if (photoGallery) {
        photoList.forEach((filename, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'gallery-item';
            
            const img = document.createElement('img');
            img.src = filename;
            img.alt = `Samyuktha & Gopi Chand - Moment ${index + 1}`;
            img.setAttribute('loading', 'lazy');
            
            // Handle image load animation
            img.style.opacity = '0';
            img.onload = () => {
                img.style.transition = 'opacity 1s ease';
                img.style.opacity = '1';
            };
            
            // Lightbox Event
            itemDiv.addEventListener('click', () => {
                if(lightboxModal) {
                    lightboxImg.src = filename;
                    lightboxModal.classList.add('active');
                }
            });
            
            itemDiv.appendChild(img);
            photoGallery.appendChild(itemDiv);
        });
    }

    if (lightboxModal) {
        lightboxClose.addEventListener('click', () => {
            lightboxModal.classList.remove('active');
        });
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) {
                lightboxModal.classList.remove('active');
            }
        });
    }
});
