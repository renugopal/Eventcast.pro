/* ═══════════════════════════════════════════════════
   WEDDING LIVESTREAM — JAVASCRIPT
   ═══════════════════════════════════════════════════ */

document.documentElement.classList.add('js-loaded');

document.addEventListener('DOMContentLoaded', () => {
<<<<<<< HEAD
  const init = (name, fn) => {
    try {
      fn();
      console.log(`[Success] ${name} initialized`);
    } catch (e) {
      console.error(`[Error] ${name} initialization failed:`, e);
      // Fallback for reveals if script fails
      if (name === 'ScrollReveal') {
        document.querySelectorAll('.reveal-bloom').forEach(el => el.classList.add('active'));
      }
    }
  };

  init('Countdown', initCountdown);
  init('Gallery', initGallery);
  init('Chat', initChat);
  init('Navigation', initNavigation);
  init('ScrollReveal', initScrollReveal);
  init('Livestream', initLivestream);
  init('Petals', initPetals);
  init('Music', initMusic);
  init('Calendar', initCalendar);
  init('WishShortcut', initWishShortcut);

  // Safety Fallback for Reveals (e.g. Chrome Observer glitches)
  // Increased to 3s and added manual scroll check
  setTimeout(() => {
    forceRevealCheck();
  }, 3000);

  window.addEventListener('scroll', forceRevealCheck, { passive: true });
=======
  initCountdown();
  initGallery();
  initChat();
  initNavigation();
  initScrollReveal();
  initLivestream();
>>>>>>> parent of eba560e (wedding mod)
});

function forceRevealCheck() {
  document.querySelectorAll('.reveal-bloom').forEach(el => {
    if (!el.classList.contains('active')) {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.9) {
        el.classList.add('active');
        console.log('[Safe-Mode] Manual trigger for:', el.id || 'section');
      }
    }
  });
}


/* ══════════════════════════════════════════════════
   COUNTDOWN TIMER
   ══════════════════════════════════════════════════ */
function initCountdown() {
  // ── SET YOUR WEDDING DATE & TIME HERE ──
  const weddingDate = new Date('2026-04-01T06:30:00+05:30');
  
  const daysEl = document.getElementById('cd-days');
  const hoursEl = document.getElementById('cd-hours');
  const minutesEl = document.getElementById('cd-minutes');
  const secondsEl = document.getElementById('cd-seconds');
  const timerContainer = document.getElementById('countdown-timer');

  function updateCountdown() {
    const now = new Date();
    const diff = weddingDate - now;

    if (diff <= 0) {
      timerContainer.innerHTML = '<p class="countdown-ended">🎊 The celebration has begun! 🎊</p>';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    daysEl.textContent = String(days).padStart(2, '0');
    hoursEl.textContent = String(hours).padStart(2, '0');
    minutesEl.textContent = String(minutes).padStart(2, '0');
    secondsEl.textContent = String(seconds).padStart(2, '0');
  }

  updateCountdown();
  setInterval(updateCountdown, 1000);
}


/* ══════════════════════════════════════════════════
   PHOTO GALLERY / SLIDESHOW
   ══════════════════════════════════════════════════ */
function initGallery() {
  const slideshow = document.getElementById('gallery-slideshow');
  const dotsContainer = document.getElementById('gallery-dots');
  const prevBtn = document.getElementById('gallery-prev');
  const nextBtn = document.getElementById('gallery-next');
  
  // ── CONFIGURE YOUR PHOTOS HERE ──
  // Add your photo filenames. Place actual photos in the same folder.
  const photos = [
    { src: 'gallery1.jpg', alt: 'Wedding Photo 1' },
    { src: 'gallery2.jpg', alt: 'Wedding Photo 2' },
    { src: 'gallery3.jpg', alt: 'Wedding Photo 3' },
    { src: 'gallery4.jpg', alt: 'Wedding Photo 4' },
    { src: 'gallery5.jpg', alt: 'Wedding Photo 5' },
    { src: 'gallery6.jpg', alt: 'Wedding Photo 6' },
    { src: 'gallery7.jpg', alt: 'Wedding Photo 7' },
    { src: 'gallery8.jpg', alt: 'Wedding Photo 8' },
  ];
  
  let currentSlide = 0;
  let autoPlayTimer = null;

  // Generate gallery placeholder images if files don't exist
  // Uses gradient placeholders for demo
  photos.forEach((photo, i) => {
    const img = document.createElement('img');
    img.src = photo.src;
    img.alt = photo.alt;
    img.loading = 'lazy';
    if (i === 0) img.classList.add('active');
    
    // Fallback: create a beautiful gradient placeholder
    img.onerror = function() {
      const colors = [
        'linear-gradient(135deg, #F0D5C8, #E8C5B5)',
        'linear-gradient(135deg, #C5D4C2, #8FA68A)',
        'linear-gradient(135deg, #C5B3CC, #A899B0)',
        'linear-gradient(135deg, #D4B87A, #B8965A)',
        'linear-gradient(135deg, #E8C5B5, #C4917B)',
        'linear-gradient(135deg, #F0D5C8, #C5D4C2)',
      ];
      // Replace with a div placeholder
      const placeholder = document.createElement('div');
      placeholder.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: ${colors[i % colors.length]};
        display: flex; align-items: center; justify-content: center;
        font-family: 'Cormorant Garamond', serif; font-size: 1.4rem;
        color: rgba(255,255,255,0.7); opacity: 0; transition: opacity 1s ease-in-out;
      `;
      placeholder.textContent = `📷 Photo ${i + 1}`;
      placeholder.dataset.slideIndex = i;
      if (i === 0) {
        placeholder.style.opacity = '1';
        placeholder.classList.add('active');
      }
      img.replaceWith(placeholder);
    };
    
    slideshow.appendChild(img);
  });

  // Dots
  photos.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.classList.add('gallery-dot');
    if (i === 0) dot.classList.add('active');
    dot.addEventListener('click', () => goToSlide(i));
    dot.setAttribute('aria-label', `Go to photo ${i + 1}`);
    dotsContainer.appendChild(dot);
  });

  function goToSlide(index) {
    const slides = slideshow.querySelectorAll('img, div[data-slide-index]');
    const dots = dotsContainer.querySelectorAll('.gallery-dot');
    
    slides.forEach(s => {
      s.classList.remove('active');
      if (s.tagName === 'DIV') s.style.opacity = '0';
    });
    dots.forEach(d => d.classList.remove('active'));

    currentSlide = index;
    if (slides[currentSlide]) {
      slides[currentSlide].classList.add('active');
      if (slides[currentSlide].tagName === 'DIV') slides[currentSlide].style.opacity = '1';
    }
    if (dots[currentSlide]) dots[currentSlide].classList.add('active');

    resetAutoPlay();
  }

  function nextSlide() {
    goToSlide((currentSlide + 1) % photos.length);
  }

  function prevSlide() {
    goToSlide((currentSlide - 1 + photos.length) % photos.length);
  }

  function resetAutoPlay() {
    clearInterval(autoPlayTimer);
    autoPlayTimer = setInterval(nextSlide, 4000);
  }

  prevBtn.addEventListener('click', prevSlide);
  nextBtn.addEventListener('click', nextSlide);

  // Auto-play
  resetAutoPlay();

  // Pause on hover
  slideshow.addEventListener('mouseenter', () => clearInterval(autoPlayTimer));
  slideshow.addEventListener('mouseleave', resetAutoPlay);

  // Touch/swipe support
  let touchStartX = 0;
  slideshow.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    clearInterval(autoPlayTimer);
  }, { passive: true });
  slideshow.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 50) {
      diff > 0 ? nextSlide() : prevSlide();
    }
    resetAutoPlay();
  }, { passive: true });
}


/* ══════════════════════════════════════════════════
   CHAT / BLESSINGS
   ══════════════════════════════════════════════════ */
function initChat() {
  const messagesContainer = document.getElementById('chat-messages');
  const nameInput = document.getElementById('chat-name');
  const messageInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  // Load saved messages from localStorage
  let messages = JSON.parse(localStorage.getItem('wedding-blessings') || '[]');

  function renderMessages() {
    if (messages.length === 0) {
      messagesContainer.innerHTML = '<div class="chat-empty">💐 Be the first to send your blessings!</div>';
      return;
    }

    messagesContainer.innerHTML = messages.map(msg => `
      <div class="chat-message">
        <div class="sender">${escapeHtml(msg.name)}</div>
        <div class="text">${escapeHtml(msg.text)}</div>
        <div class="time">${msg.time}</div>
      </div>
    `).join('');

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function sendMessage() {
    const name = nameInput.value.trim();
    const text = messageInput.value.trim();

    if (!name) {
      nameInput.focus();
      nameInput.style.borderBottomColor = '#C4917B';
      setTimeout(() => nameInput.style.borderBottomColor = '', 2000);
      return;
    }

    if (!text) {
      messageInput.focus();
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    }) + ' · ' + now.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short'
    });

    messages.push({ name, text, time: timeStr });
    localStorage.setItem('wedding-blessings', JSON.stringify(messages));

    messageInput.value = '';
    renderMessages();
  }

  // Event listeners
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Initial render
  renderMessages();

  // Save name for convenience
  const savedName = localStorage.getItem('wedding-guest-name');
  if (savedName) nameInput.value = savedName;
  nameInput.addEventListener('blur', () => {
    if (nameInput.value.trim()) {
      localStorage.setItem('wedding-guest-name', nameInput.value.trim());
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


/* ══════════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════════ */
function initNavigation() {
  const nav = document.getElementById('floating-nav');
  const dots = nav.querySelectorAll('.nav-dot');
  const sections = ['hero', 'details', 'countdown', 'livestream', 'gallery', 'chat', 'venue'];

  // Click to scroll
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const sectionId = dot.dataset.section;
      const section = document.getElementById(sectionId);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // Update active dot on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        dots.forEach(d => d.classList.remove('active'));
        const activeDot = nav.querySelector(`[data-section="${id}"]`);
        if (activeDot) activeDot.classList.add('active');
      }
    });
  }, { 
    threshold: 0.3,
    rootMargin: '-10% 0px -10% 0px'
  });

  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });

  // Hide nav on hero, show on scroll
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    if (scrollY < 200) {
      nav.style.opacity = '0';
      nav.style.pointerEvents = 'none';
    } else {
      nav.style.opacity = '1';
      nav.style.pointerEvents = 'all';
    }
    lastScroll = scrollY;
  }, { passive: true });

  // Initial state
  nav.style.opacity = '0';
  nav.style.pointerEvents = 'none';
}


/* ══════════════════════════════════════════════════
   SCROLL REVEAL ANIMATION
   ══════════════════════════════════════════════════ */
function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
<<<<<<< HEAD
        entry.target.classList.add('active');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.05,
    rootMargin: '0px 0px -10% 0px'
=======
        entry.target.classList.add('visible');
      }
    });
  }, { 
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
>>>>>>> parent of eba560e (wedding mod)
  });

  reveals.forEach(el => observer.observe(el));
}


/* ══════════════════════════════════════════════════
   LIVESTREAM EMBED
   ══════════════════════════════════════════════════ */
function initLivestream() {
  const container = document.getElementById('livestream-embed');
  const placeholder = document.getElementById('livestream-placeholder');
  
  if (!placeholder) return;
  
  const videoId = placeholder.dataset.videoId;
  
  // If a real video ID is set, embed it
  if (videoId && videoId !== 'YOUR_YOUTUBE_VIDEO_ID') {
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0`;
    iframe.title = 'Wedding Livestream';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    
    placeholder.remove();
    container.appendChild(iframe);
  }
  
  // Click on placeholder to prompt for video
  placeholder.addEventListener('click', () => {
    placeholder.querySelector('h3').textContent = 'Stream will appear here';
    placeholder.querySelector('p').textContent = 'Replace YOUR_YOUTUBE_VIDEO_ID in the HTML to activate';
  });
}
<<<<<<< HEAD


/* ══════════════════════════════════════════════════
   FALLING PETALS ANIMATION
   ══════════════════════════════════════════════════ */
function initPetals() {
  const container = document.createElement('div');
  container.className = 'petal-container';
  document.body.appendChild(container);

  const petalCount = 20; // Maximum number of petals at once for performance
  const petalInterval = 600; // Milliseconds between new petals

  function createPetal() {
    if (document.hidden) return; // Don't create if tab is inactive
    
    const petal = document.createElement('div');
    const size = Math.random() * 10 + 10; // 10-20px
    const left = Math.random() * 100; // 0-100%
    const duration = Math.random() * 10 + 8; // 8-18s
    const color = Math.floor(Math.random() * 4) + 1; // 1-4
    
    // Randomize sway and rotation
    const sway = (Math.random() * 200 - 100) + 'px';
    const rotation = (Math.random() * 720 - 360) + 'deg';
    const scale = (Math.random() * 0.5 + 0.8); // 0.8 to 1.3
    
    petal.className = `petal color-${color}`;
    petal.style.left = left + '%';
    petal.style.width = size + 'px';
    petal.style.height = size + 'px';
    petal.style.animationDuration = duration + 's';
    
    // Set custom variables for keyframes
    petal.style.setProperty('--sway', sway);
    petal.style.setProperty('--rotation', rotation);
    petal.style.setProperty('--scale', scale);
    
    container.appendChild(petal);

    // Remove petal after animation
    setTimeout(() => {
      petal.remove();
    }, duration * 1000);
  }

  // Initial batch
  for(let i=0; i<5; i++) {
    setTimeout(createPetal, Math.random() * 5000);
  }
  
  // Continuous generation
  setInterval(createPetal, petalInterval);
}


/* ══════════════════════════════════════════════════
   BACKGROUND MUSIC & SMART MUTE
   ══════════════════════════════════════════════════ */
let bgMusic = null;
let ytPlayer = null;

function initMusic() {
  bgMusic = document.getElementById('bg-music');
  const toggle = document.getElementById('music-toggle');
  let isPlaying = false;

  // Start music on first interaction (browser requirement)
  const startMusic = (e) => {
    if (!isPlaying) {
      bgMusic.volume = 1.0; 
      bgMusic.play().then(() => {
        isPlaying = true;
        toggle.classList.add('playing');
        toggle.innerHTML = '<span>🔊</span>';
      }).catch(err => console.log("Autoplay blocked:", err));
    }
    // Remove all triggers once music starts
    ['click', 'touchstart', 'scroll', 'mousedown', 'mousemove'].forEach(evt => {
      document.removeEventListener(evt, startMusic);
    });
    
    // Hide the hint if it exists
    const hint = document.getElementById('music-starter-hint');
    if (hint) {
      hint.style.opacity = '0';
      setTimeout(() => hint.remove(), 500);
    }
  };

  // Pre-load the audio properly
  bgMusic.load();

  // Create a "Tap to Experience" hint for Chrome Mobile
  const createMusicHint = () => {
    if (document.getElementById('music-starter-hint')) return;
    const hint = document.createElement('div');
    hint.id = 'music-starter-hint';
    hint.innerHTML = '<span>🎵</span><p>Tap to enter with music</p>';
    document.body.appendChild(hint);
    hint.addEventListener('click', () => {
        bgMusic.volume = 1.0; 
        bgMusic.play();
        isPlaying = true;
        toggle.classList.add('playing');
        toggle.innerHTML = '<span>🔊</span>';
        hint.style.opacity = '0';
        setTimeout(() => hint.remove(), 500);
    });
  };

  // Only show hint on mobile if music hasn't started in 2 seconds
  if (window.innerWidth < 768) {
      setTimeout(() => {
          if (!isPlaying) createMusicHint();
      }, 2000);
  }

  // Listen for any form of guest interaction
  const triggers = ['click', 'touchstart', 'scroll', 'mousedown', 'mousemove'];
  triggers.forEach(evt => {
    document.addEventListener(evt, startMusic, { once: true, passive: true });
  });

  // Explicitly try play on first toggle click too
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isPlaying) {
      bgMusic.volume = 1.0; 
      bgMusic.play();
      isPlaying = true;
      toggle.classList.add('playing');
      toggle.innerHTML = '<span>🔊</span>';
      // Remove hint if user used the toggle instead
      const hint = document.getElementById('music-starter-hint');
      if (hint) hint.remove();
    } else {
      bgMusic.pause();
      toggle.classList.remove('playing');
      toggle.innerHTML = '<span>🔇</span>';
      isPlaying = false;
    }
  });

  // Load YouTube IFrame API for smart muting
  const tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

// Called automatically by YouTube API
window.onYouTubeIframeAPIReady = function() {
  const placeholder = document.getElementById('livestream-placeholder');
  const videoId = placeholder.getAttribute('data-video-id');

  ytPlayer = new YT.Player('livestream-embed', {
    height: '100%',
    width: '100%',
    videoId: videoId,
    playerVars: {
      'autoplay': 0,
      'modestbranding': 1,
      'rel': 0
    },
    events: {
      'onStateChange': onPlayerStateChange
    }
  });
};

function onPlayerStateChange(event) {
  // If video is playing (1) or buffering (3), mute background music
  if (event.data == YT.PlayerState.PLAYING || event.data == YT.PlayerState.BUFFERING) {
    if (bgMusic && !bgMusic.paused) {
      bgMusic.volume = 0.2; // Fade down
      setTimeout(() => { if (bgMusic.volume > 0) bgMusic.pause(); }, 500);
    }
  } else if (event.data == YT.PlayerState.PAUSED || event.data == YT.PlayerState.ENDED) {
    // Optional: Resume background music softly
    // if (bgMusic) { bgMusic.play(); bgMusic.volume = 1; }
  }
}


/* ══════════════════════════════════════════════════
   SAVE THE DATE — CALENDAR
   ══════════════════════════════════════════════════ */
function initCalendar() {
  const calBtn = document.getElementById('add-to-calendar');
  if (!calBtn) return;

  calBtn.addEventListener('click', () => {
    const title = "Gopi Chand & Samyuktha Wedding";
    const desc = "Join us for our wedding celebration! Livestream available at: https://eventcast.pro/gopichand-samyuktha/";
    const loc = "Kunkalamarru, Bapatla District, Andhra Pradesh";
    const start = "20260401T063000"; // YYYYMMDDTHHMMSS
    const end = "20260401T120000";

    // Google Calendar Link
    const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(desc)}&location=${encodeURIComponent(loc)}&dates=${start}/${end}`;

    // Simple choice: open Google Calendar or download .ics
    if (confirm("Open in Google Calendar? (Cancel to download for Apple/Outlook)")) {
      window.open(googleUrl, '_blank');
    } else {
      const icsData = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:${title}\nDESCRIPTION:${desc}\nLOCATION:${loc}\nDTSTART:${start}\nDTEND:${end}\nEND:VEVENT\nEND:VCALENDAR`;
      const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute('download', 'wedding_invite.ics');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  });
}


/* ══════════════════════════════════════════════════
   FLOATING WISH SHORTCUT
   ══════════════════════════════════════════════════ */
function initWishShortcut() {
  const shortcut = document.getElementById('wish-shortcut');
  if (!shortcut) return;

  shortcut.addEventListener('click', (e) => {
    e.preventDefault();
    const chatSection = document.getElementById('chat');
    if (chatSection) {
      // Chrome Mobile Fallback
      const offsetTop = chatSection.offsetTop;
      window.scrollTo({
        top: offsetTop,
        behavior: 'smooth'
      });
    }
  });

  // Hide shortcut when already in chat section
  window.addEventListener('scroll', () => {
    const chatPos = document.getElementById('chat').getBoundingClientRect().top;
    if (chatPos < window.innerHeight / 2) {
      shortcut.style.opacity = '0';
      shortcut.style.pointerEvents = 'none';
    } else {
      shortcut.style.opacity = '1';
      shortcut.style.pointerEvents = 'auto';
    }
  });
}


/* ══════════════════════════════════════════════════
   COUNTDOWN CELEBRATION (CONFETTI)
   ══════════════════════════════════════════════════ */
function triggerConfetti() {
    const colors = ['#F4C7B8', '#FDF8F4', '#D4B87A', '#E8C5B5'];
  const confettiCount = 50;

  for (let i = 0; i < confettiCount; i++) {
    const particle = document.createElement('div');
    particle.style.cssText = `
      position: fixed;
      top: -10px;
      left: ${Math.random() * 100}%;
      width: ${Math.random() * 8 + 4}px;
      height: ${Math.random() * 8 + 4}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      border-radius: 50%;
      z-index: 3000;
      opacity: 0.8;
      pointer-events: none;
      transform: rotate(${Math.random() * 360}deg);
    `;

    document.body.appendChild(particle);

    const destX = (Math.random() * 200 - 100) + 'px';
    const destY = (window.innerHeight + 10) + 'px';
    const duration = (Math.random() * 3 + 2) + 's';

    const animation = particle.animate([
      { transform: 'translateY(0) translateX(0) rotate(0)', opacity: 0.8 },
      { transform: `translateY(${destY}) translateX(${destX}) rotate(720deg)`, opacity: 0 }
    ], {
      duration: parseFloat(duration) * 1000,
      easing: 'cubic-bezier(0.1, 0.5, 0.4, 1)'
    });

    animation.onfinish = () => particle.remove();
  }
}

/* ══════════════════════════════════════════════════
   TOUCH INTERACTIONS (SCALE EFFECTS)
   ══════════════════════════════════════════════════ */
document.querySelectorAll('button, .nav-dot, .gallery-btn, .chat-send-btn, .venue-map-btn, .calendar-btn').forEach(btn => {
  btn.addEventListener('touchstart', () => {
    btn.style.transform = (btn.style.transform || '') + ' scale(0.95)';
  }, { passive: true });
  btn.addEventListener('touchend', () => {
    btn.style.transform = btn.style.transform.replace(' scale(0.95)', '');
  }, { passive: true });
});

=======
>>>>>>> parent of eba560e (wedding mod)
