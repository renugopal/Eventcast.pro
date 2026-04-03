/* ═══════════════════════════════════════════════════
   WEDDING LIVESTREAM — JAVASCRIPT
   ═══════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  initCountdown();
  initGallery();
  initChat();
  initNavigation();
  initScrollReveal();
  initLivestream();
  initPetals(); // New falling petals effect
});


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
   CHAT / BLESSINGS (Supabase)
   ══════════════════════════════════════════════════ */
const SUPABASE_URL = 'https://ntjqjmuripwexwlhfrny.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vi_vz9qfKMJnEymw3WaPpg_2A6SeSWR';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const EVENT_ID = 'gopichand-samyuktha';

function initChat() {
  const messagesContainer = document.getElementById('chat-messages');
  const nameInput = document.getElementById('chat-name');
  const messageInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  async function fetchMessages() {
    const { data, error } = await _supabase
      .from('wishes')
      .select('*')
      .eq('event_id', EVENT_ID)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching messages:', error);
      return;
    }
    renderMessages(data);
  }

  function renderMessages(messages) {
    if (messages.length === 0) {
      messagesContainer.innerHTML = '<div class="chat-empty">💐 Be the first to send your blessings!</div>';
      return;
    }

    messagesContainer.innerHTML = messages.map(msg => `
      <div class="chat-message">
        <div class="sender">${escapeHtml(msg.name)}</div>
        <div class="text">${escapeHtml(msg.message)}</div>
        <div class="time">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
      </div>
    `).join('');

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  async function sendMessage() {
    const name = nameInput.value.trim();
    const message = messageInput.value.trim();

    if (!name) {
      nameInput.focus();
      return;
    }

    if (!message) {
      messageInput.focus();
      return;
    }

    sendBtn.disabled = true;
    const { error } = await _supabase
      .from('wishes')
      .insert([{ name, message, event_id: EVENT_ID }]);

    if (error) {
      alert('Error: ' + error.message);
    } else {
      messageInput.value = '';
    }
    sendBtn.disabled = false;
  }

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  _supabase.channel('public:wishes_gs')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes' }, payload => {
      fetchMessages();
    }).subscribe();

  fetchMessages();

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
  const sections = ['hero', 'countdown', 'livestream', 'gallery', 'chat', 'venue'];

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
        entry.target.classList.add('visible');
      }
    });
  }, { 
    threshold: 0.05, // Lower threshold for better mobile triggering
    rootMargin: '0px 0px -10px 0px' 
  });

  reveals.forEach(el => {
    observer.observe(el);
    // Safety fallback: Reveal everything if for some reason observer fails after 3 seconds
    setTimeout(() => el.classList.add('visible'), 3000);
  });
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


/* ══════════════════════════════════════════════════
   FALLING FLOWER PETALS (CANVAS EFFECT)
   ══════════════════════════════════════════════════ */
function initPetals() {
  const canvas = document.getElementById('petal-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let petals = [];
  const petalCount = 45; // Smooth but not overwhelming
  const colors = ['#FADADD', '#F8C8DC', '#F0D5C8', '#FFFFFF', '#FFD1DC'];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  class Petal {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height - canvas.height;
      this.size = Math.random() * 10 + 6;
      this.speedY = Math.random() * 0.8 + 0.4; // Slower vertical speed
      this.speedX = Math.random() * 1 - 0.5; // Gentler horizontal drift
      this.swing = Math.random() * 2 + 1;
      this.swingSpeed = Math.random() * 0.03 + 0.01; // Gentler sway
      this.angle = Math.random() * Math.PI * 2;
      this.rotateSpeed = Math.random() * 0.015 - 0.0075; // Slower rotation
      this.color = colors[Math.floor(Math.random() * colors.length)];
      this.opacity = Math.random() * 0.5 + 0.3;
      this.flip = Math.random();
    }
    update() {
      this.y += this.speedY;
      this.x += this.speedX + Math.sin(this.y * 0.01) * this.swing;
      this.angle += this.rotateSpeed;
      if (this.y > canvas.height + this.size) {
        this.reset();
        this.y = -this.size;
      }
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      ctx.globalAlpha = this.opacity;
      ctx.fillStyle = this.color;
      
      // Draw an organic petal shape (ellipse-like)
      ctx.beginPath();
      ctx.ellipse(0, 0, this.size, this.size / (1.5 + this.flip), 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Subtle highlight line on the petal
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-this.size/2, 0);
      ctx.lineTo(this.size/2, 0);
      ctx.stroke();
      
      ctx.restore();
    }
  }

  for (let i = 0; i < petalCount; i++) {
    petals.push(new Petal());
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    petals.forEach(p => {
      p.update();
      p.draw();
    });
    requestAnimationFrame(animate);
  }
  animate();
}
