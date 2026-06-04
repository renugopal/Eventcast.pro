document.addEventListener("DOMContentLoaded", () => {
    
    // --- CONFIG DRIVEN LOGIC ---
    const CONFIG = window.WEDDING_CONFIG || {
        groom: "Ameer Basha",
        bride: "Mubeena",
        date: "Friday, June 5th",
        time: "10:30 AM",
        timerTarget: "2026-06-05T10:30:00+05:30",
        venue: "ASR Convention, Lalpuram, Chilakaluripeta Road, Beside NH Road, Guntur, Andhra Pradesh",
        youtubeId: "9V-TMCzFtVw",
        restreamerUrl: "", // Disabled for direct YouTube stream
        supabaseUrl: 'https://ntjqjmuripwexwlhfrny.supabase.co',
        supabaseKey: 'sb_publishable_vi_vz9qfKMJnEymw3WaPpg_2A6SeSWR',
        eventId: 'mubeena-ameerbasha-nikah',
        eventType: 'Nikah Ceremony'
    };

    const EVENT_ID = CONFIG.eventId;
    const _supabase = (CONFIG.supabaseUrl && CONFIG.supabaseKey) 
        ? supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey) 
        : null;

    // 1. LOADER FUNCTIONALITY
    const loader = document.getElementById("loader");
    if (loader) {
        window.addEventListener("load", () => {
            setTimeout(() => {
                loader.style.opacity = "0";
                loader.style.visibility = "hidden";
            }, 600); // Smooth fade out after 600ms
        });
    }

    // 2. COUNTDOWN TIMER
    const targetDate = new Date(CONFIG.timerTarget).getTime();
    
    const countdownTimer = setInterval(() => {
        const now = new Date().getTime();
        const difference = targetDate - now;

        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);

        // Update DOM
        const dEl = document.getElementById("days");
        const hEl = document.getElementById("hours");
        const mEl = document.getElementById("minutes");
        const sEl = document.getElementById("seconds");

        if (dEl) dEl.innerText = String(Math.max(0, days)).padStart(2, "0");
        if (hEl) hEl.innerText = String(Math.max(0, hours)).padStart(2, "0");
        if (mEl) mEl.innerText = String(Math.max(0, minutes)).padStart(2, "0");
        if (sEl) sEl.innerText = String(Math.max(0, seconds)).padStart(2, "0");

        // If countdown finishes
        if (difference < 0) {
            clearInterval(countdownTimer);
            if (dEl) dEl.innerText = "00";
            if (hEl) hEl.innerText = "00";
            if (mEl) mEl.innerText = "00";
            if (sEl) sEl.innerText = "00";
            
            // Change header title when live
            const countdownTitle = document.querySelector(".countdown-title");
            if (countdownTitle) {
                countdownTitle.innerText = "EVENT HAS STARTED";
            }
            
            // Update status badge in livestream
            const statusBadge = document.querySelector(".status-badge");
            if (statusBadge) {
                statusBadge.innerHTML = '<span class="pulse-dot" style="background-color: #52c41a;"></span> LIVE NOW';
                statusBadge.style.color = "#52c41a";
                statusBadge.style.backgroundColor = "#f6ffed";
                statusBadge.style.borderColor = "#b7eb8f";
            }
        }
    }, 1000);

    // 3. ADD TO CALENDAR
    const addToCalendarBtn = document.getElementById("add-to-calendar-btn");
    if (addToCalendarBtn) {
        addToCalendarBtn.addEventListener("click", () => {
            const title = encodeURIComponent(`${CONFIG.groom} & ${CONFIG.bride} ${CONFIG.eventType}`);
            const startEndDates = "20260605T050000Z/20260605T083000Z";
            const details = encodeURIComponent("Witness the beautiful wedding live stream of Shaik Mubeena Roshini & Tummalagodu Ameer Basha. Live streaming links and wishes wall available on Eventcast.");
            const location = encodeURIComponent(CONFIG.venue);
            
            const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startEndDates}&details=${details}&location=${location}&sf=true&output=xml`;
            
            window.open(googleCalendarUrl, "_blank");
        });
    }

    // 4. SUPABASE WISHES WALL
    const wishesForm = document.getElementById("wishes-form");
    const wishesList = document.getElementById("wishes-list");

    const escapeHTML = (str) => {
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    };

    const renderWishes = (wishesData) => {
        if (!wishesList) return;
        wishesList.innerHTML = "";
        
        if (!wishesData || wishesData.length === 0) {
            wishesList.innerHTML = `<p style="opacity:0.5; text-align:center; padding: 2rem; font-family: Inter, sans-serif;">Send your blessings to ${CONFIG.bride} & ${CONFIG.groom}!</p>`;
            return;
        }

        wishesData.forEach(wish => {
            const wishItem = document.createElement("div");
            wishItem.className = "wish-item";
            
            // Format time nicely
            let timeStr = "Just now";
            if (wish.created_at) {
                const date = new Date(wish.created_at);
                timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            wishItem.innerHTML = `
                <div class="wish-header">
                    <span class="wish-author">${escapeHTML(wish.name)}</span>
                    <span class="wish-time">${timeStr}</span>
                </div>
                <p class="wish-body">${escapeHTML(wish.message)}</p>
            `;
            wishesList.appendChild(wishItem);
        });
    };

    const fetchWishes = async () => {
        if (!_supabase) {
            // LocalStorage Fallback if Supabase credentials are missing
            const localWishes = JSON.parse(localStorage.getItem("nikah_wishes")) || [];
            renderWishes(localWishes);
            return;
        }

        const { data, error } = await _supabase
            .from('wishes')
            .select('*')
            .eq('event_id', EVENT_ID)
            .order('created_at', { ascending: false });

        if (!error) {
            renderWishes(data);
        }
    };

    // Submit Wish Form Handler
    if (wishesForm) {
        wishesForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById("wish-name");
            const messageInput = document.getElementById("wish-message");
            const submitBtn = wishesForm.querySelector("button");

            const name = nameInput.value.trim();
            const message = messageInput.value.trim();

            if (!name || !message) return;

            submitBtn.disabled = true;
            const originalText = submitBtn.innerHTML;
            submitBtn.textContent = 'Sending...';

            if (_supabase) {
                const { error } = await _supabase
                    .from('wishes')
                    .insert([{ name, message, event_id: EVENT_ID }]);

                if (error) {
                    alert('Error: ' + error.message);
                } else {
                    wishesForm.reset();
                    submitBtn.innerHTML = 'Sent Successfully! ❤️';
                    setTimeout(() => { submitBtn.innerHTML = originalText; }, 3000);
                    fetchWishes();
                }
            } else {
                // LocalStorage Fallback
                const localWishes = JSON.parse(localStorage.getItem("nikah_wishes")) || [];
                localWishes.unshift({
                    name,
                    message,
                    created_at: new Date().toISOString()
                });
                localStorage.setItem("nikah_wishes", JSON.stringify(localWishes));
                wishesForm.reset();
                submitBtn.innerHTML = 'Sent Successfully! ❤️';
                setTimeout(() => { submitBtn.innerHTML = originalText; }, 3000);
                renderWishes(localWishes);
            }
            submitBtn.disabled = false;
        });
    }

    // Subscribe to realtime wish updates
    if (_supabase) {
        _supabase.channel(`public:wishes:${EVENT_ID}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes', filter: `event_id=eq.${EVENT_ID}` }, () => {
                fetchWishes();
            }).subscribe();
    }

    // 5. LIVESTREAM PLAYER WITH FALLBACK
    const initLivestream = () => {
        const playerContainer = document.getElementById('youtube-player');
        const fallbackContainer = document.getElementById('yt-fallback-container');
        const statusBadge = document.querySelector('.status-badge');

        if (!CONFIG.youtubeId && !CONFIG.restreamerUrl) {
            const livestreamSection = document.getElementById('livestream');
            if (livestreamSection) livestreamSection.style.display = 'none';
            return;
        }

        // Check if Restreamer/HLS URL is provided
        if (CONFIG.restreamerUrl) {
            console.log("Initializing HLS Player...");
            if (playerContainer) {
                playerContainer.innerHTML = `
                    <div class="plyr-container" style="position:absolute; top:0; left:0; width:100%; height:100%; overflow:hidden; background:#000; border-radius:12px;">
                        <video id="hls-video" controls width="100%" height="100%" playsinline style="width:100%; height:100%; object-fit:contain; border-radius:12px;"></video>
                        <div id="hls-loader" style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:10; background:rgba(0,0,0,0.6); border-radius:12px; color: white; text-align: center; font-family: Inter, sans-serif; padding: 20px;">
                            <i class="fas fa-spinner fa-spin" style="font-size:2.5rem; margin-bottom:12px; color: #cca762;"></i>
                            <p style="letter-spacing:1.5px; font-size: 0.85rem; text-transform:uppercase;">Waiting for Stream to Start...</p>
                        </div>
                    </div>
                `;

                // Watch on YouTube button below player container
                if (CONFIG.youtubeId && fallbackContainer) {
                    fallbackContainer.innerHTML = `
                        <a href="https://youtube.com/watch?v=${CONFIG.youtubeId}" target="_blank" class="maps-btn" style="display:inline-flex; align-items:center; justify-content:center; gap:10px; margin-top:15px; background: linear-gradient(135deg, #e52d27 0%, #b31217 100%); color: white; border: none; min-width: 220px; text-decoration: none;">
                            <i class="fa-brands fa-youtube" style="font-size:1.1rem;"></i> Watch on YouTube
                        </a>
                    `;
                }

                // Inject CSS rules for Plyr integration dynamically
                const style = document.createElement('style');
                style.innerHTML = `
                    .plyr { height: 100% !important; width: 100% !important; }
                    .plyr__video-wrapper { height: 100% !important; width: 100% !important; }
                    .plyr--video { background: #000 !important; }
                `;
                document.head.appendChild(style);

                const video = document.getElementById('hls-video');
                const loader = document.getElementById('hls-loader');
                const loaderText = loader ? loader.querySelector('p') : null;
                let isPlaying = false;
                let hls = null;
                let player = null;
                let pollInterval = null;

                const updateStatus = (isLive) => {
                    if (statusBadge) {
                        if (isLive) {
                            statusBadge.innerHTML = '<span class="pulse-dot" style="background-color: #52c41a;"></span> LIVE NOW';
                            statusBadge.style.color = "#52c41a";
                            statusBadge.style.backgroundColor = "#f6ffed";
                            statusBadge.style.borderColor = "#b7eb8f";
                        } else {
                            statusBadge.innerHTML = '<span class="pulse-dot"></span> LIVE SOON';
                            statusBadge.style.color = "";
                            statusBadge.style.backgroundColor = "";
                            statusBadge.style.borderColor = "";
                        }
                    }
                };

                const showLoader = (text) => {
                    if (loader) {
                        loader.style.display = 'flex';
                        if (loaderText && text) loaderText.innerText = text;
                    }
                };

                const hideLoader = () => {
                    if (loader) loader.style.display = 'none';
                };

                const destroyHls = () => {
                    if (video && video._dropHandlers) {
                        video.removeEventListener('waiting', video._dropHandlers);
                        video.removeEventListener('stalled', video._dropHandlers);
                        video.removeEventListener('ended', video._dropHandlers);
                        delete video._dropHandlers;
                    }
                    if (player) {
                        player.destroy();
                        player = null;
                    }
                    if (hls) {
                        hls.destroy();
                        hls = null;
                    }
                    isPlaying = false;
                };

                const tryLoadStream = () => {
                    if (isPlaying) return;
                    
                    fetch(CONFIG.restreamerUrl, { method: 'HEAD', cache: 'no-store' })
                        .then(res => {
                           if (res.ok) {
                               console.log("Live stream online!");
                               hideLoader();
                               isPlaying = true;
                               updateStatus(true);
                               
                               if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                                   hls = new Hls({ 
                                       capLevelToPlayerSize: true, 
                                       maxBufferLength: 30,
                                       maxMaxBufferLength: 60,
                                       enableWorker: true,
                                       lowLatencyMode: true
                                   });
                                   hls.loadSource(CONFIG.restreamerUrl);
                                   hls.attachMedia(video);

                                   const checkStreamStatusOnDrop = () => {
                                       if (!isPlaying) return;
                                       fetch(CONFIG.restreamerUrl, { method: 'HEAD', cache: 'no-store' })
                                           .then(res => {
                                               if (!res.ok) {
                                                   destroyHls();
                                                   showLoader("Stream Interrupted. Reconnecting...");
                                                   startPolling();
                                               }
                                           })
                                           .catch(() => {
                                               destroyHls();
                                               showLoader("Stream Interrupted. Reconnecting...");
                                               startPolling();
                                           });
                                   };

                                   video.addEventListener('waiting', checkStreamStatusOnDrop);
                                   video.addEventListener('stalled', checkStreamStatusOnDrop);
                                   video.addEventListener('ended', checkStreamStatusOnDrop);
                                   video._dropHandlers = checkStreamStatusOnDrop;

                                   hls.on(Hls.Events.MANIFEST_PARSED, function() {
                                       if (typeof Plyr !== 'undefined') {
                                           player = new Plyr(video, {
                                               controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
                                               tooltips: { controls: true, seek: true }
                                           });
                                       }
                                       video.play().catch(e => console.log("Autoplay prevented:", e));
                                   });

                                   hls.on(Hls.Events.ERROR, function(event, data) {
                                       if (data.fatal) {
                                           switch (data.type) {
                                               case Hls.ErrorTypes.NETWORK_ERROR:
                                                   destroyHls();
                                                   showLoader("Stream Interrupted. Reconnecting...");
                                                   startPolling();
                                                   break;
                                               case Hls.ErrorTypes.MEDIA_ERROR:
                                                   hls.recoverMediaError();
                                                   break;
                                               default:
                                                   destroyHls();
                                                   showLoader("Waiting for Stream...");
                                                   startPolling();
                                                   break;
                                           }
                                       }
                                   });
                               } else if (video && video.canPlayType('application/vnd.apple.mpegurl')) {
                                   video.src = CONFIG.restreamerUrl;
                                   video.addEventListener('loadedmetadata', function() {
                                       video.play().catch(e => console.log("Autoplay prevented:", e));
                                   });
                               }
                           } else {
                               startPolling();
                           }
                        })
                        .catch(() => {
                            startPolling();
                        });
                };

                const startPolling = () => {
                    if (pollInterval) return;
                    pollInterval = setTimeout(() => {
                        pollInterval = null;
                        tryLoadStream();
                    }, 3000);
                };
                
                tryLoadStream();
            }
        } else if (CONFIG.youtubeId) {
            // Default directly to YouTube embed
            if (playerContainer) {
                playerContainer.innerHTML = `<iframe allowfullscreen="" src="https://www.youtube.com/embed/${CONFIG.youtubeId}?&amp;rel=0&amp;modestbranding=1" title="Nikah Ceremony Live Stream" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" style="position:absolute; top:0; left:0; width:100%; height:100%;"></iframe>`;
            }
        }
    };

    // 6. ANALYTICS (PAGE VIEWS)
    const trackView = async () => {
        if (!_supabase || !EVENT_ID) return;
        try {
            const userAgent = navigator.userAgent;
            const deviceType = /Mobi|Android/i.test(userAgent) ? 'Mobile' :
                               /Tablet|iPad/i.test(userAgent) ? 'Tablet' : 'Desktop';
            const referrer = document.referrer.includes('whatsapp') ? 'WhatsApp' :
                             document.referrer.includes('instagram') ? 'Instagram' :
                             document.referrer.includes('facebook') ? 'Facebook' : 'Direct';
            
            // Insert view log
            await _supabase.from('page_views').insert([{
                event_id: EVENT_ID,
                device_type: deviceType,
                referrer: referrer,
                user_agent: userAgent,
                country: 'Unknown'
            }]);
            
            // Fetch total views count
            const { count } = await _supabase
                .from('page_views')
                .select('*', { count: 'exact', head: true })
                .eq('event_id', EVENT_ID);
                
            const display = document.getElementById('total-views-display');
            if (display && count !== null) {
                display.innerText = count.toLocaleString();
            }
        } catch (e) {
            console.error("Analytics failure:", e);
        }
    };

    // Initial triggers
    fetchWishes();
    initLivestream();
    trackView();
});
