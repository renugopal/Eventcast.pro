document.addEventListener('DOMContentLoaded', () => {

    /* --- Countdown Logic --- */
    // Target: April 1, 2026, 18:00:00 IST (UTC+5:30)
    // Create Date from UTC offset format
    const targetDate = new Date('2026-04-01T18:00:00+05:30').getTime();
    
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
            // Party has started
            timerContainer.classList.add('hidden');
            liveMessage.classList.remove('hidden');
            
            // Update stream status badge
            streamStatus.textContent = 'Live now';
            streamStatus.classList.remove('live-starting-soon');
            streamStatus.classList.add('live-now');
            
            return;
        }
        
        // Time calculations for days, hours, minutes and seconds
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        // Display formatting (pad with zeros if needed)
        daysEl.textContent = days;
        hoursEl.textContent = hours.toString().padStart(2, '0');
        minutesEl.textContent = minutes.toString().padStart(2, '0');
        secondsEl.textContent = seconds.toString().padStart(2, '0');
    }
    
    // Initial call
    updateCountdown();
    // Update every 1 second
    setInterval(updateCountdown, 1000);

    /* --- Wishes Form Logic --- */
    const wishesForm = document.getElementById('wishes-form');
    const wishesList = document.getElementById('wishes-list');
    
    // Initial Dummy Wishes Let's create an array of initial wishes
    const initialWishes = [];
    
    function createWishElement(name, text) {
        const wishCard = document.createElement('div');
        wishCard.className = 'wish-card';
        
        const wishHeader = document.createElement('div');
        wishHeader.className = 'wish-header';
        // Prefix with balloon emoji
        wishHeader.textContent = `🎈 ${name}`;
        
        const wishBody = document.createElement('div');
        wishBody.className = 'wish-body';
        wishBody.textContent = text;
        
        wishCard.appendChild(wishHeader);
        wishCard.appendChild(wishBody);
        
        return wishCard;
    }
    
    // Pre-fill the list
    initialWishes.forEach(wish => {
        wishesList.appendChild(createWishElement(wish.name, wish.text));
    });
    
    wishesForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const nameInput = document.getElementById('wish-name');
        const messageInput = document.getElementById('wish-message');
        
        const nameVal = nameInput.value.trim();
        const textVal = messageInput.value.trim();
        
        if (nameVal && textVal) {
            const newWish = createWishElement(nameVal, textVal);
            // Append to the top of the list
            wishesList.prepend(newWish);
            
            // Clear input fields
            nameInput.value = '';
            messageInput.value = '';
        }
    });

    /* --- Scroll Fade-in Animation (Intersection Observer) --- */
    const faders = document.querySelectorAll('.fade-in');
    
    const appearOptions = {
        threshold: 0.1, // Trigger when 10% of element is visible
        rootMargin: "0px 0px -50px 0px"
    };
    
    const appearOnScroll = new IntersectionObserver(function(entries, observer) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            
            // Add visible class
            entry.target.classList.add('visible');
            // Unobserve to only animate once
            observer.unobserve(entry.target);
        });
    }, appearOptions);
    
    faders.forEach(fader => {
        appearOnScroll.observe(fader);
    });

    /* --- Confetti Generator --- */
    const confettiContainer = document.getElementById('confetti');
    const colors = ['#d4af37', '#f5dfac', '#b58d24', '#ffffff'];
    
    function createConfetti() {
        const particle = document.createElement('div');
        particle.classList.add('particle');
        
        // Randomize
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const leftPosition = Math.random() * 100; // 0 to 100vw
        const animationDuration = Math.random() * 3 + 4; // 4s to 7s
        const size = Math.random() * 6 + 4; // 4px to 10px
        const delay = Math.random() * 10;
        
        particle.style.backgroundColor = randomColor;
        particle.style.left = `${leftPosition}vw`;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.animationDuration = `${animationDuration}s`;
        particle.style.animationDelay = `${delay}s`;
        
        confettiContainer.appendChild(particle);
        
        // Cleanup particle after it falls to prevent memory leak
        // Not strictly necessary since infinite animation handles looping, 
        // but if we were to delete it, we'd do setTimeout.
        // For visual consistency, letting pure CSS loop it is efficient.
    }
    
    // Create 40 particles
    for (let i = 0; i < 40; i++) {
        createConfetti();
    }

    /* --- Dynamic Photo Gallery --- */
    const photoGallery = document.getElementById('photo-gallery');
    
    // WANT TO ADD MORE PHOTOS? 
    // Simply add the new file names to this list below!
    const photoList = [
        "photo1.jpeg",
        "photo2.jpeg",
        "photo3.jpeg",
        "photo4.jpeg",
        "photo5.jpeg",
        "pic (1).jpeg",
        "pic (2).jpeg",
        "pic (3).jpeg",
        "pic (4).jpeg",
        "pic (5).jpeg",
        "pic (6).jpeg",
        "pic (7).jpeg",
        "pic (8).jpeg",
        "pic (9).jpeg",
        "pic (10).jpeg",
        "pic (11).jpeg",
        "pic (12).jpeg",
        "pic (13).jpeg"
    ];
    
    if (photoGallery) {
        photoList.forEach((filename, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'gallery-item';
            
            const img = document.createElement('img');
            img.src = filename;
            img.alt = `Ishaan Moment ${index + 1}`;
            
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

    /* --- Lightbox Functionality --- */
    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.querySelector('.lightbox-close');

    if (lightboxModal) {
        lightboxClose.addEventListener('click', () => {
            lightboxModal.classList.remove('active');
        });

        // Close when clicking outside the image
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) {
                lightboxModal.classList.remove('active');
            }
        });
    }

});
