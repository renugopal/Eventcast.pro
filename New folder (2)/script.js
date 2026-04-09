/* ═══════════════════════════════════════════════════════════════════════════════
   WEDDING LIVESTREAM LANDING PAGE
   Premium Single-Page Application
   Vanilla JavaScript (ES6+)
   ═══════════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION OBJECT
// Easily modify event details, stream URLs, and API keys here
// ═══════════════════════════════════════════════════════════════════════════════
const CONFIG = {
    // Event Details
    event: {
        brideName: 'Sarah',
        groomName: 'Michael',
        // Set your event date/time (use ISO 8601 format for timezone accuracy)
        // Example: '2024-12-15T16:00:00-05:00' for 4:00 PM EST
        dateTime: '2024-12-15T16:00:00-05:00',
        displayDate: 'December 15, 2024',
        displayTime: '4:00 PM EST',
    },

    // Livestream Configuration
    stream: {
        // YouTube: '[youtube.com](https://www.youtube.com/embed/VIDEO_ID?autoplay=1)'
        // Vimeo: '[player.vimeo.com](https://player.vimeo.com/video/VIDEO_ID?autoplay=1)'
        embedUrl: '[youtube.com](https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1)',
        // Set to true when the stream is actually live
        isLive: false,
        // Time (in minutes) before event to show the stream player
        preStreamMinutes: 30,
    },

    // Venue Details
    venue: {
        name: 'The Grand Ballroom',
        address: '123 Elegant Avenue, New York, NY 10001',
        // Google Maps embed URL
        // Get this from Google Maps > Share > Embed a map
        mapEmbedUrl: '[google.com](https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3022.9663095919364!2d-74.00425878428698!3d40.71277937933185!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x89c25a1634e6d9f7%3A0x5bc97a3ef64e6877!2sCity%20Hall%20Park!5e0!3m2!1sen!2sus!4v1699999999999!5m2!1sen!2sus)',
        // Google Maps directions URL
        directionsUrl: '[google.com](https://www.google.com/maps/dir/?api=1&destination=40.71277937933185,-74.00425878428698)',
    },

    // Backend Integration (Supabase/Firebase)
    // Replace with your actual credentials
    backend: {
        provider: 'supabase', // 'supabase' or 'firebase'
        
        // Supabase Configuration
        supabase: {
            url: '[your-project.supabase.co](https://your-project.supabase.co)',
            anonKey: 'your-anon-key-here',
            tableName: 'wedding_wishes',
        },
        
        // Firebase Configuration (alternative)
        firebase: {
            apiKey: 'your-api-key',
            authDomain: 'your-project.firebaseapp.com',
            projectId: 'your-project-id',
            storageBucket: 'your-project.appspot.com',
            messagingSenderId: 'your-sender-id',
            appId: 'your-app-id',
            collectionName: 'wedding_wishes',
        },
    },

    // UI Settings
    ui: {
        preloaderDuration: 3000, // Minimum preloader duration in ms
        animationDelay: 100, // Delay between reveal animations
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// APPLICATION STATE
// ═══════════════════════════════════════════════════════════════════════════════
const state = {
    isLoaded: false,
    countdownInterval: null,
    isStreamActive: false,
    wishes: [],
    viewerCount: 0,
    backendConnected: false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// DOM ELEMENTS CACHE
// ═══════════════════════════════════════════════════════════════════════════════
const elements = {};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Safely select a DOM element
 */
function $(selector) {
    return document.querySelector(selector);
}

/**
 * Safely select all matching DOM elements
 */
function $$(selector) {
    return document.querySelectorAll(selector);
}

/**
 * Cache frequently accessed DOM elements
 */
function cacheElements() {
    elements.preloader = $('#preloader');
    elements.loaderProgress = $('#loaderProgress');
    elements.mainContent = $('#mainContent');
    
    // Countdown elements
    elements.countdownTimer = $('#countdownTimer');
    elements.countDays = $('#countDays');
    elements.countHours = $('#countHours');
    elements.countMinutes = $('#countMinutes');
    elements.countSeconds = $('#countSeconds');
    elements.livestreamCTA = $('#livestreamCTA');
    
    // Event display elements
    elements.eventDateDisplay = $('#eventDateDisplay');
    elements.eventTimeDisplay = $('#eventTimeDisplay');
    elements.footerDate = $('#footerDate');
    
    // Stream elements
    elements.videoPlaceholder = $('#videoPlaceholder');
    elements.streamIframe = $('#streamIframe');
    elements.liveBadge = $('#liveBadge');
    elements.streamStatus = $('#streamStatus');
    elements.viewerNumber = $('#viewerNumber');
    elements.refreshStream = $('#refreshStream');
    
    // Wish elements
    elements.wishForm = $('#wishForm');
    elements.guestName = $('#guestName');
    elements.guestMessage = $('#guestMessage');
    elements.charCount = $('#charCount');
    elements.submitWish = $('#submitWish');
    elements.formSuccess = $('#formSuccess');
    elements.wishWall = $('#wishWall');
    elements.wishWallEmpty = $('#wishWallEmpty');
    elements.wishCount = $('#wishCount');
    
    // Venue elements
    elements.venueName = $('#venueName');
    elements.venueAddress = $('#venueAddress');
    elements.venueMap = $('#venueMap');
    elements.directionsBtn = $('#directionsBtn');
}

/**
 * Format a number to always show two digits
 */
function padZero(num) {
    return String(num).padStart(2, '0');
}

/**
 * Get time ago string from timestamp
 */
function timeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

/**
 * Get initials from a name
 */
function getInitials(name) {
    return name
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

/**
 * Sanitize HTML to prevent XSS
 */
function sanitizeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRELOADER
// ═══════════════════════════════════════════════════════════════════════════════

function initPreloader() {
    let progress = 0;
    const startTime = Date.now();
    const minDuration = CONFIG.ui.preloaderDuration;
    
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) progress = 90;
        
        elements.loaderProgress.style.width = `${progress}%`;
    }, 200);
    
    // Wait for minimum duration and page load
    const checkComplete = () => {
        const elapsed = Date.now() - startTime;
        
        if (elapsed >= minDuration && document.readyState === 'complete') {
            clearInterval(progressInterval);
            
            // Complete the progress bar
            elements.loaderProgress.style.width = '100%';
            
            setTimeout(() => {
                elements.preloader.classList.add('fade-out');
                elements.mainContent.classList.remove('hidden');
                
                // Initialize reveal animations after content is visible
                setTimeout(() => {
                    initRevealAnimations();
                    state.isLoaded = true;
                }, 100);
            }, 400);
        } else {
            requestAnimationFrame(checkComplete);
        }
    };
    
    if (document.readyState === 'complete') {
        setTimeout(checkComplete, 100);
    } else {
        window.addEventListener('load', checkComplete);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COUNTDOWN TIMER
// ═══════════════════════════════════════════════════════════════════════════════

function initCountdown() {
    const targetDate = new Date(CONFIG.event.dateTime).getTime();
    
    function updateCountdown() {
        const now = Date.now();
        const diff = targetDate - now;
        
        if (diff <= 0) {
            // Event has started
            clearInterval(state.countdownInterval);
            showLivestreamCTA();
            return;
        }
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        // Update DOM with animation
        animateValue(elements.countDays, padZero(days));
        animateValue(elements.countHours, padZero(hours));
        animateValue(elements.countMinutes, padZero(minutes));
        animateValue(elements.countSeconds, padZero(seconds));
        
        // Check if we should show pre-stream
        const minutesUntilEvent = diff / (1000 * 60);
        if (minutesUntilEvent <= CONFIG.stream.preStreamMinutes && !state.isStreamActive) {
            activateStream();
        }
    }
    
    // Initial update
    updateCountdown();
    
    // Update every second
    state.countdownInterval = setInterval(updateCountdown, 1000);
}

/**
 * Animate value changes in countdown
 */
function animateValue(element, newValue) {
    if (element.textContent !== newValue) {
        element.style.transform = 'scale(1.1)';
        element.textContent = newValue;
        setTimeout(() => {
            element.style.transform = 'scale(1)';
        }, 150);
    }
}

/**
 * Show the livestream CTA when countdown ends
 */
function showLivestreamCTA() {
    elements.countdownTimer.classList.add('hidden');
    elements.livestreamCTA.classList.remove('hidden');
    
    // Also activate the stream
    activateStream();
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVESTREAM FUNCTIONALITY
// ═══════════════════════════════════════════════════════════════════════════════

function initLivestream() {
    // Check if stream should be active based on time
    const targetDate = new Date(CONFIG.event.dateTime).getTime();
    const now = Date.now();
    const minutesUntilEvent = (targetDate - now) / (1000 * 60);
    
    if (minutesUntilEvent <= CONFIG.stream.preStreamMinutes || CONFIG.stream.isLive) {
        activateStream();
    }
    
    // Refresh stream button
    elements.refreshStream?.addEventListener('click', () => {
        refreshStream();
    });
    
    // Simulate viewer count updates
    simulateViewerCount();
}

/**
 * Activate the stream player
 */
function activateStream() {
    if (state.isStreamActive) return;
    
    state.isStreamActive = true;
    
    // Update status message
    elements.streamStatus.textContent = 'Connecting to stream...';
    
    // Load the iframe
    setTimeout(() => {
        elements.streamIframe.src = CONFIG.stream.embedUrl;
        elements.streamIframe.classList.remove('hidden');
        elements.videoPlaceholder.classList.add('hidden');
        
        if (CONFIG.stream.isLive) {
            elements.liveBadge.classList.add('visible');
        }
    }, 1000);
}

/**
 * Refresh the stream
 */
function refreshStream() {
    const currentSrc = elements.streamIframe.src;
    elements.streamIframe.src = '';
    setTimeout(() => {
        elements.streamIframe.src = currentSrc;
    }, 100);
}

/**
 * Simulate viewer count for demo purposes
 * In production, this would connect to your backend
 */
function simulateViewerCount() {
    let baseCount = Math.floor(Math.random() * 50) + 20;
    
    function updateCount() {
        const change = Math.floor(Math.random() * 5) - 2;
        baseCount = Math.max(10, baseCount + change);
        elements.viewerNumber.textContent = baseCount;
    }
    
    updateCount();
    setInterval(updateCount, 5000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUEST WISHES FUNCTIONALITY
// ═══════════════════════════════════════════════════════════════════════════════

function initWishForm() {
    // Character counter
    elements.guestMessage?.addEventListener('input', () => {
        const count = elements.guestMessage.value.length;
        elements.charCount.textContent = count;
        
        if (count > 280) {
            elements.charCount.style.color = 'var(--color-error)';
        } else {
            elements.charCount.style.color = '';
        }
    });
    
    // Form submission
    elements.wishForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitWish();
    });
    
    // Load existing wishes
    loadWishes();
}

/**
 * Submit a new wish
 */
async function submitWish() {
    const name = elements.guestName.value.trim();
    const message = elements.guestMessage.value.trim();
    
    if (!name || !message) return;
    
    // Disable submit button
    elements.submitWish.disabled = true;
    elements.submitWish.innerHTML = '<span>Sending...</span>';
    
    const wish = {
        id: Date.now(),
        name: name,
        message: message,
        timestamp: Date.now(),
    };
    
    try {
        // Try to save to backend
        if (state.backendConnected) {
            await saveWishToBackend(wish);
        }
        
        // Add to local state
        state.wishes.unshift(wish);
        
        // Update UI
        renderWish(wish, true);
        updateWishCount();
        
        // Show success message
        elements.formSuccess.classList.remove('hidden');
        
        // Reset form after delay
        setTimeout(() => {
            elements.wishForm.reset();
            elements.charCount.textContent = '0';
            elements.submitWish.disabled = false;
            elements.submitWish.innerHTML = `
                <span>Send Wishes</span>
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 2L11 13"></path>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z"></path>
                </svg>
            `;
            elements.formSuccess.classList.add('hidden');
        }, 3000);
        
    } catch (error) {
        console.error('Failed to submit wish:', error);
        elements.submitWish.disabled = false;
        elements.submitWish.innerHTML = `
            <span>Send Wishes</span>
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 2L11 13"></path>
                <path d="M22 2L15 22L11 13L2 9L22 2Z"></path>
            </svg>
        `;
    }
}

/**
 * Load wishes from backend or local storage
 */
async function loadWishes() {
    try {
        // Try to connect to backend
        const wishes = await loadWishesFromBackend();
        state.wishes = wishes;
        state.backendConnected = true;
    } catch (error) {
        console.log('Backend not available, using local storage');
        // Fallback to local storage
        const stored = localStorage.getItem('wedding_wishes');
        if (stored) {
            state.wishes = JSON.parse(stored);
        }
    }
    
    // Render wishes
    renderAllWishes();
    
    // Set up real-time updates if backend is connected
    if (state.backendConnected) {
        subscribeToWishes();
    }
}

/**
 * Render all wishes
 */
function renderAllWishes() {
    if (state.wishes.length === 0) {
        elements.wishWallEmpty.classList.remove('hidden');
        return;
    }
    
    elements.wishWallEmpty.classList.add('hidden');
    
    state.wishes.forEach(wish => {
        renderWish(wish, false);
    });
    
    updateWishCount();
}

/**
 * Render a single wish
 */
function renderWish(wish, prepend = false) {
    elements.wishWallEmpty?.classList.add('hidden');
    
    const wishElement = document.createElement('div');
    wishElement.className = 'wish-item';
    wishElement.dataset.id = wish.id;
    
    wishElement.innerHTML = `
        <div class="wish-header">
            <div class="wish-avatar">${getInitials(sanitizeHTML(wish.name))}</div>
            <div class="wish-meta">
                <span class="wish-name">${sanitizeHTML(wish.name)}</span>
                <span class="wish-time">${timeAgo(wish.timestamp)}</span>
            </div>
        </div>
        <p class="wish-message">${sanitizeHTML(wish.message)}</p>
    `;
    
    if (prepend) {
        elements.wishWall.insertBefore(wishElement, elements.wishWall.firstChild);
    } else {
        elements.wishWall.appendChild(wishElement);
    }
}

/**
 * Update wish count display
 */
function updateWishCount() {
    const count = state.wishes.length;
    elements.wishCount.textContent = `${count} ${count === 1 ? 'wish' : 'wishes'}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKEND INTEGRATION (Supabase/Firebase)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize backend connection
 */
async function initBackend() {
    const provider = CONFIG.backend.provider;
    
    if (provider === 'supabase') {
        return initSupabase();
    } else if (provider === 'firebase') {
        return initFirebase();
    }
}

/**
 * Initialize Supabase client
 * Note: In production, include the Supabase JS library
 */
async function initSupabase() {
    // Check if Supabase library is loaded
    if (typeof window.supabase === 'undefined') {
        console.log('Supabase client not loaded. Include @supabase/supabase-js');
        return false;
    }
    
    const { createClient } = window.supabase;
    const config = CONFIG.backend.supabase;
    
    window.supabaseClient = createClient(config.url, config.anonKey);
    return true;
}

/**
 * Initialize Firebase client
 * Note: In production, include the Firebase JS library
 */
async function initFirebase() {
    // Check if Firebase library is loaded
    if (typeof window.firebase === 'undefined') {
        console.log('Firebase client not loaded. Include firebase-app and firebase-firestore');
        return false;
    }
    
    const config = CONFIG.backend.firebase;
    
    firebase.initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
    });
    
    window.firestore = firebase.firestore();
    return true;
}

/**
 * Save wish to backend
 */
async function saveWishToBackend(wish) {
    const provider = CONFIG.backend.provider;
    
    // Also save to local storage as backup
    const localWishes = JSON.parse(localStorage.getItem('wedding_wishes') || '[]');
    localWishes.unshift(wish);
    localStorage.setItem('wedding_wishes', JSON.stringify(localWishes.slice(0, 100)));
    
    if (provider === 'supabase' && window.supabaseClient) {
        const { error } = await window.supabaseClient
            .from(CONFIG.backend.supabase.tableName)
            .insert([wish]);
        
        if (error) throw error;
    } else if (provider === 'firebase' && window.firestore) {
        await window.firestore
            .collection(CONFIG.backend.firebase.collectionName)
            .add(wish);
    }
}

/**
 * Load wishes from backend
 */
async function loadWishesFromBackend() {
    const provider = CONFIG.backend.provider;
    
    if (provider === 'supabase' && window.supabaseClient) {
        const { data, error } = await window.supabaseClient
            .from(CONFIG.backend.supabase.tableName)
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(50);
        
        if (error) throw error;
        return data || [];
    } else if (provider === 'firebase' && window.firestore) {
        const snapshot = await window.firestore
            .collection(CONFIG.backend.firebase.collectionName)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();
        
        return snapshot.docs.map(doc => doc.data());
    }
    
    throw new Error('No backend available');
}

/**
 * Subscribe to real-time wish updates
 */
function subscribeToWishes() {
    const provider = CONFIG.backend.provider;
    
    if (provider === 'supabase' && window.supabaseClient) {
        window.supabaseClient
            .channel('wishes')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: CONFIG.backend.supabase.tableName,
                },
                (payload) => {
                    // Check if wish already exists locally
                    if (!state.wishes.find(w => w.id === payload.new.id)) {
                        state.wishes.unshift(payload.new);
                        renderWish(payload.new, true);
                        updateWishCount();
                    }
                }
            )
            .subscribe();
    } else if (provider === 'firebase' && window.firestore) {
        window.firestore
            .collection(CONFIG.backend.firebase.collectionName)
            .orderBy('timestamp', 'desc')
            .limit(1)
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added') {
                        const wish = change.doc.data();
                        if (!state.wishes.find(w => w.id === wish.id)) {
                            state.wishes.unshift(wish);
                            renderWish(wish, true);
                            updateWishCount();
                        }
                    }
                });
            });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VENUE MAP
// ═══════════════════════════════════════════════════════════════════════════════

function initVenueMap() {
    // Update venue info
    elements.venueName.textContent = CONFIG.venue.name;
    elements.venueAddress.querySelector('span').textContent = CONFIG.venue.address;
    
    // Set map iframe source
    elements.venueMap.src = CONFIG.venue.mapEmbedUrl;
    
    // Set directions button URL
    elements.directionsBtn.href = CONFIG.venue.directionsUrl;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVEAL ANIMATIONS (Intersection Observer)
// ═══════════════════════════════════════════════════════════════════════════════

function initRevealAnimations() {
    const revealElements = $$('.reveal-fade, .reveal-scale, .reveal-slide-left, .reveal-slide-right');
    
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry, index) => {
                    if (entry.isIntersecting) {
                        // Add staggered delay for multiple elements
                        setTimeout(() => {
                            entry.target.classList.add('revealed');
                        }, index * CONFIG.ui.animationDelay);
                        
                        observer.unobserve(entry.target);
                    }
                });
            },
            {
                root: null,
                rootMargin: '0px 0px -50px 0px',
                threshold: 0.1,
            }
        );
        
        revealElements.forEach(el => observer.observe(el));
    } else {
        // Fallback: reveal all immediately
        revealElements.forEach(el => el.classList.add('revealed'));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMOOTH SCROLL FOR ANCHOR LINKS
// ═══════════════════════════════════════════════════════════════════════════════

function initSmoothScroll() {
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href^="#"]');
        
        if (link) {
            e.preventDefault();
            const targetId = link.getAttribute('href').slice(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                });
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE DISPLAY VALUES FROM CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

function updateDisplayFromConfig() {
    // Update event date/time displays
    if (elements.eventDateDisplay) {
        elements.eventDateDisplay.textContent = CONFIG.event.displayDate;
    }
    if (elements.eventTimeDisplay) {
        elements.eventTimeDisplay.textContent = CONFIG.event.displayTime;
    }
    if (elements.footerDate) {
        elements.footerDate.textContent = CONFIG.event.displayDate;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

function init() {
    // Cache DOM elements
    cacheElements();
    
    // Update display values from config
    updateDisplayFromConfig();
    
    // Initialize preloader
    initPreloader();
    
    // Initialize countdown
    initCountdown();
    
    // Initialize livestream
    initLivestream();
    
    // Initialize wish form
    initWishForm();
    
    // Initialize venue map
    initVenueMap();
    
    // Initialize smooth scroll
    initSmoothScroll();
    
    // Try to initialize backend
    initBackend().catch(() => {
        console.log('Running in offline mode');
    });
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT CONFIG FOR EXTERNAL MODIFICATION (if needed)
// ═══════════════════════════════════════════════════════════════════════════════
window.WeddingStreamConfig = CONFIG;
window.WeddingStreamState = state;
