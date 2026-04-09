/* ============================================================
   CONFIG OBJECT — Edit all event details here
============================================================ */
const CONFIG = {
  // ----- Event Details -----
  eventName:    "Amara & Julian's Wedding",
  eventDate:    "2026-08-16T16:00:00", // ISO format — LOCAL time of event
  eventTimezone:"America/New_York",    // IANA timezone string

  // ----- Stream Embed -----
  // Replace with your actual YouTube or Vimeo embed URL
  streamUrl:  "https://www.youtube.com/embed/live_stream?channel=UCkszU2WH9gy1mb0dV-11UJg&autoplay=1",
  // Set to true once the stream is actually live
  isLive:     false,
  // Simulated viewer count range [min, max]
  viewerRange: [124, 512],

  // ----- Venue / Map -----
  venueAddress: "123 Rosewood Lane, Charleston, SC 29401",
  directionsUrl:"https://maps.google.com/?q=123+Rosewood+Lane+Charleston+SC+29401",

  // ----- Guest Wish Wall Backend -----
  // ---- OPTION A: Supabase ----
  supabase: {
    enabled: false,                           // Set to true to enable
    url:    "YOUR_SUPABASE_PROJECT_URL",      // e.g. https://xxxx.supabase.co
    key:    "YOUR_SUPABASE_ANON_KEY",
    table:  "wishes",
  },

  // ---- OPTION B: Firebase Firestore ----
  firebase: {
    enabled: false,                           // Set to true to enable
    apiKey:            "YOUR_FIREBASE_API_KEY",
    authDomain:        "YOUR_PROJECT.firebaseapp.com",
    projectId:         "YOUR_PROJECT_ID",
    storageBucket:     "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId:             "YOUR_APP_ID",
    collection:        "wishes",
  },

  // Demo wishes shown when no backend is connected
  demoWishes: [
    { name: "Emily & Robert Chen", message: "Wishing you both a lifetime of love, laughter, and adventure. We are so honoured to witness this beautiful moment." },
    { name: "The Vasquez Family",  message: "May every day of your marriage be as radiant as today. Sending our warmest love from across the miles." },
    { name: "Jasmine T.",          message: "Amara, you look absolutely breathtaking. Julian, you are the luckiest man alive! Congratulations to you both!" },
  ],
};

/* ============================================================
   PRELOADER
============================================================ */
(function initLoader() {
  const bar     = document.getElementById("loaderBar");
  const percent = document.getElementById("loaderPercent");
  const loader  = document.getElementById("preloader");
  const main    = document.getElementById("mainContent");

  let progress = 0;
  const interval = setInterval(() => {
    // Eased increment — speeds up then slows near 100
    const step = progress < 60 ? 1.8 : progress < 85 ? 0.9 : 0.4;
    progress = Math.min(progress + step, 100);

    bar.style.width = progress + "%";
    percent.textContent = Math.floor(progress) + "%";

    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        loader.classList.add("loaded");
        main.classList.add("visible");
        main.removeAttribute("aria-hidden");
        initApp();
      }, 500);
    }
  }, 28);
})();

/* ============================================================
   APP INITIALISATION
============================================================ */
function initApp() {
  initBokeh();
  initCountdown();
  initScrollReveal();
  initLiveStream();
  initWishWall();
  initViewerCounter();
}

/* ============================================================
   BOKEH CANVAS — Floating light particles
============================================================ */
function initBokeh() {
  const canvas = document.getElementById("bokehCanvas");
  const ctx    = canvas.getContext("2d");
  let particles = [];
  let W, H;

  const COLORS = [
    "rgba(201, 169, 110, ",  // gold
    "rgba(212, 160, 160, ",  // rose
    "rgba(245, 239, 230, ",  // cream
  ];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function createParticle() {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    return {
      x:     Math.random() * W,
      y:     Math.random() * H,
      r:     Math.random() * 3.5 + 1,
      alpha: Math.random() * 0.12 + 0.03,
      vx:    (Math.random() - 0.5) * 0.18,
      vy:    (Math.random() - 0.5) * 0.18,
      pulse: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.008 + 0.004,
      color,
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: 80 }, createParticle);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.pulse += p.speed;
      const a = p.alpha + Math.sin(p.pulse) * 0.04;
      ctx.beginPath();
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.5);
      grad.addColorStop(0, p.color + Math.min(a, 0.18) + ")");
      grad.addColorStop(1, p.color + "0)");
      ctx.fillStyle = grad;
      ctx.arc(p.x, p.y, p.r * 3.5, 0, Math.PI * 2);
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -20) p.x = W + 20;
      if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20;
      if (p.y > H + 20) p.y = -20;
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", () => {
    resize();
    particles.forEach(p => {
      if (p.x > W) p.x = Math.random() * W;
      if (p.y > H) p.y = Math.random() * H;
    });
  });

  init();
  draw();
}

/* ============================================================
   SMART COUNTDOWN
============================================================ */
function initCountdown() {
  const eventTime = new Date(CONFIG.eventDate).getTime();

  const els = {
    days:    document.getElementById("cdDays"),
    hours:   document.getElementById("cdHours"),
    minutes: document.getElementById("cdMinutes"),
    seconds: document.getElementById("cdSeconds"),
    display: document.getElementById("countdownDisplay"),
    liveCta: document.getElementById("liveCta"),
  };

  function pad(n) { return String(n).padStart(2, "0"); }

  function animateValue(el, newVal) {
    if (el.textContent !== newVal) {
      el.style.transform = "translateY(-6px)";
      el.style.opacity   = "0";
      setTimeout(() => {
        el.textContent     = newVal;
        el.style.transform = "translateY(0)";
        el.style.opacity   = "1";
      }, 150);
    }
  }

  function tick() {
    const now  = Date.now();
    const diff = eventTime - now;

    if (diff <= 0) {
      // Countdown over — transform UI to LIVE state
      els.display.style.opacity = "0";
      els.display.style.pointerEvents = "none";
      setTimeout(() => {
        els.display.style.display = "none";
        els.liveCta.style.display = "flex";
        // Also activate live badge
        activateLiveBadge();
      }, 400);
      return;
    }

    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    animateValue(els.days,    pad(d));
    animateValue(els.hours,   pad(h));
    animateValue(els.minutes, pad(m));
    animateValue(els.seconds, pad(s));

    setTimeout(tick, 1000);
  }

  // Add transition to countdown values
  [els.days, els.hours, els.minutes, els.seconds].forEach(el => {
    el.style.transition = "transform 0.15s ease, opacity 0.15s ease";
  });

  tick();
}

/* ============================================================
   SCROLL REVEAL — Intersection Observer
============================================================ */
function initScrollReveal() {
  const targets = document.querySelectorAll(".reveal-up");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

  targets.forEach(el => observer.observe(el));
}

/* ============================================================
   LIVESTREAM HUB
============================================================ */
function initLiveStream() {
  const iframe  = document.getElementById("streamEmbed");
  const overlay = document.getElementById("videoOfflineOverlay");
  const liveText= document.getElementById("liveText");

  if (CONFIG.isLive) {
    iframe.src = CONFIG.streamUrl;
    overlay.classList.add("hidden");
    activateLiveBadge();
  }
}

function activateLiveBadge() {
  const dot  = document.querySelector(".live-dot");
  const text = document.getElementById("liveText");
  if (dot)  dot.classList.add("active");
  if (text) text.textContent = "Live Now";
}

/* ============================================================
   VIEWER COUNTER — Simulated
============================================================ */
function initViewerCounter() {
  const el = document.getElementById("viewerCount");
  const [min, max] = CONFIG.viewerRange;
  let count = Math.floor(Math.random() * (max - min) + min);

  function update() {
    const delta = Math.floor(Math.random() * 7) - 3;
    count = Math.max(min, Math.min(max, count + delta));
    el.textContent = count.toLocaleString();
    setTimeout(update, 3500 + Math.random() * 2000);
  }

  update();
}

/* ============================================================
   WISH WALL — Backend Integration + Local Fallback
============================================================ */
function initWishWall() {
  const form    = document.getElementById("wishForm");
  const nameIn  = document.getElementById("guestName");
  const msgIn   = document.getElementById("guestMessage");
  const charCnt = document.getElementById("charCount");
  const wallEl  = document.getElementById("wishWall");
  const emptyEl = document.getElementById("wishEmpty");
  const countEl = document.getElementById("wishCount");
  const successEl= document.getElementById("formSuccess");
  const submitBtn= document.getElementById("submitWishBtn");

  let wishes = [];

  // Character counter
  msgIn.addEventListener("input", () => {
    charCnt.textContent = msgIn.value.length;
  });

  // Load initial wishes
  loadWishes();

  // Form submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();

    const name = nameIn.value.trim();
    const msg  = msgIn.value.trim();
    let valid  = true;

    if (!name) {
      showError("nameError", "Please enter your name.");
      nameIn.classList.add("error");
      valid = false;
    }
    if (!msg || msg.length < 5) {
      showError("msgError", "Please enter a message (min. 5 characters).");
      msgIn.classList.add("error");
      valid = false;
    }
    if (!valid) return;

    // Show loading state
    submitBtn.querySelector(".btn-text").style.display = "none";
    submitBtn.querySelector(".btn-loader").style.display = "inline";
    submitBtn.disabled = true;

    const wish = { name, message: msg, created_at: new Date().toISOString() };

    try {
      await postWish(wish);
      wishes.unshift(wish);
      renderWishes();
      form.reset();
      charCnt.textContent = "0";
      successEl.style.display = "block";
      setTimeout(() => { successEl.style.display = "none"; }, 5000);
    } catch (err) {
      console.error("Wish submit error:", err);
      showError("msgError", "Could not send your message. Please try again.");
    } finally {
      submitBtn.querySelector(".btn-text").style.display = "inline";
      submitBtn.querySelector(".btn-loader").style.display = "none";
      submitBtn.disabled = false;
    }
  });

  function clearErrors() {
    document.getElementById("nameError").textContent = "";
    document.getElementById("msgError").textContent  = "";
    nameIn.classList.remove("error");
    msgIn.classList.remove("error");
  }

  function showError(id, msg) {
    document.getElementById(id).textContent = msg;
  }

  async function loadWishes() {
    try {
      wishes = await fetchWishes();
    } catch (e) {
      wishes = [...CONFIG.demoWishes]; // fallback to demo data
    }
    renderWishes();
  }

  function renderWishes() {
    if (wishes.length === 0) {
      emptyEl.style.display = "block";
      countEl.textContent = "0";
      return;
    }

    emptyEl.style.display = "none";
    countEl.textContent   = wishes.length;
    wallEl.innerHTML      = "";

    wishes.forEach((w, i) => {
      const card = document.createElement("div");
      card.className = "wish-card";
      card.style.animationDelay = (i * 60) + "ms";
      card.innerHTML = `
        <div class="wish-card__header">
          <span class="wish-card__name">${escapeHtml(w.name)}</span>
          <span class="wish-card__time">${formatTime(w.created_at)}</span>
        </div>
        <p class="wish-card__message">${escapeHtml(w.message)}</p>
      `;
      wallEl.appendChild(card);
    });
  }

  /* ---------- Backend Connector ---------- */
  async function fetchWishes() {
    // --- Supabase ---
    if (CONFIG.supabase.enabled) {
      const res = await fetch(
        `${CONFIG.supabase.url}/rest/v1/${CONFIG.supabase.table}?order=created_at.desc&limit=50`,
        { headers: {
            "apikey":        CONFIG.supabase.key,
            "Authorization": `Bearer ${CONFIG.supabase.key}`,
        }}
      );
      if (!res.ok) throw new Error("Supabase fetch error");
      return await res.json();
    }

    // --- Firebase Firestore (REST API) ---
    if (CONFIG.firebase.enabled) {
      const url  = `https://firestore.googleapis.com/v1/projects/${CONFIG.firebase.projectId}/databases/(default)/documents/${CONFIG.firebase.collection}?key=${CONFIG.firebase.apiKey}`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error("Firebase fetch error");
      const data = await res.json();
      if (!data.documents) return [];
      return data.documents.map(doc => ({
        name:       doc.fields.name?.stringValue || "",
        message:    doc.fields.message?.stringValue || "",
        created_at: doc.fields.created_at?.stringValue || new Date().toISOString(),
      })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // Fallback — demo data
    return [...CONFIG.demoWishes];
  }

  async function postWish(wish) {
    // --- Supabase ---
    if (CONFIG.supabase.enabled) {
      const res = await fetch(
        `${CONFIG.supabase.url}/rest/v1/${CONFIG.supabase.table}`,
        {
          method: "POST",
          headers: {
            "apikey":        CONFIG.supabase.key,
            "Authorization": `Bearer ${CONFIG.supabase.key}`,
            "Content-Type":  "application/json",
            "Prefer":        "return=minimal",
          },
          body: JSON.stringify(wish),
        }
      );
      if (!res.ok) throw new Error("Supabase post error");
      return;
    }

    // --- Firebase Firestore ---
    if (CONFIG.firebase.enabled) {
      const url = `https://firestore.googleapis.com/v1/projects/${CONFIG.firebase.projectId}/databases/(default)/documents/${CONFIG.firebase.collection}?key=${CONFIG.firebase.apiKey}`;
      const body = {
        fields: {
          name:       { stringValue: wish.name },
          message:    { stringValue: wish.message },
          created_at: { stringValue: wish.created_at },
        }
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Firebase post error");
      return;
    }

    // No backend — local only (simulate network delay)
    await new Promise(r => setTimeout(r, 600));
  }
}

/* ============================================================
   UTILITY FUNCTIONS
============================================================ */
function escapeHtml(str) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return String(str).replace(/[&<>"']/g, m => map[m]);
}

function formatTime(iso) {
  if (!iso) return "Just now";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60)  return "Just now";
    if (diff < 3600)return Math.floor(diff / 60) + "m ago";
    if (diff < 86400)return Math.floor(diff / 3600) + "h ago";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return ""; }
}

function showToast(msg, duration = 3500) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

function copyStreamLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    showToast("Stream link copied to clipboard!");
  }).catch(() => {
    showToast("Could not copy — please copy the URL manually.");
  });
}

function toggleFullscreen() {
  const wrapper = document.querySelector(".video-wrapper");
  if (!document.fullscreenElement) {
    wrapper.requestFullscreen().catch(err => {
      showToast("Fullscreen unavailable: " + err.message);
    });
  } else {
    document.exitFullscreen();
  }
}
