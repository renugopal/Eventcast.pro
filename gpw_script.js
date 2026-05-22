// ============================================================
// GUEST PHOTO WALL
// Browser-side WebP compression â†’ R2 upload via /api/guest-photos/upload
// Supabase Realtime for live photo grid updates
// ============================================================
(function initGuestPhotoWall() {
    if (!window.WEDDING_CONFIG || !WEDDING_CONFIG.guestPhotoWallEnabled) return;
    if (!WEDDING_CONFIG.eventId) return;

    const section    = document.getElementById('guest-photo-wall');
    const uploadArea = document.getElementById('gpw-upload-area');
    const fileInput  = document.getElementById('gpw-file-input');
    const nameArea   = document.getElementById('gpw-name-area');
    const nameInput  = document.getElementById('gpw-uploader-name');
    const submitBtn  = document.getElementById('gpw-submit-btn');
    const progress   = document.getElementById('gpw-progress');
    const progressTx = document.getElementById('gpw-progress-text');
    const limitMsg   = document.getElementById('gpw-limit-msg');
    const grid       = document.getElementById('gpw-grid');

    if (!section || !grid) return;

    const LIMIT = WEDDING_CONFIG.guestPhotoLimit || 50;
    let selectedFile = null;
    let currentCount = 0;

    section.style.display = '';

    async function loadPhotos() {
        if (!_supabase) return;
        const { data, error } = await _supabase
            .from('guest_photos')
            .select('id, photo_url, uploader_name, created_at')
            .eq('event_id', WEDDING_CONFIG.eventId)
            .eq('approved', true)
            .order('created_at', { ascending: false });
        if (error || !data) return;
        currentCount = data.length;
        grid.innerHTML = '';
        data.forEach(p => addPhotoCard(p, true));
        checkLimit();
    }

    function addPhotoCard(photo, append) {
        const card = document.createElement('div');
        card.className = 'gpw-photo-card';
        card.dataset.photoId = photo.id;
        card.innerHTML = `
            <img src="${photo.photo_url}" alt="Photo by ${escapeHTML(photo.uploader_name)}" loading="lazy">
            <div class="gpw-name-badge">${escapeHTML(photo.uploader_name)}</div>
        `;
        if (append) grid.appendChild(card);
        else grid.insertBefore(card, grid.firstChild);
    }

    function checkLimit() {
        if (currentCount >= LIMIT) {
            uploadArea.style.display = 'none';
            nameArea.style.display = 'none';
            limitMsg.style.display = 'block';
        } else {
            uploadArea.style.display = '';
            limitMsg.style.display = 'none';
        }
    }

    function compressToWebP(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX = 1200;
                    let w = img.width, h = img.height;
                    if (w > MAX || h > MAX) {
                        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                        else       { w = Math.round(w * MAX / h); h = MAX; }
                    }
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    canvas.toBlob(blob => resolve(blob || file), 'image/webp', 0.78);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        selectedFile = file;
        nameArea.style.display = 'block';
        nameInput.focus();
    });

    submitBtn.addEventListener('click', async () => {
        if (!selectedFile) return;
        const name = nameInput.value.trim();
        if (!name) {
            nameInput.style.borderColor = 'rgba(239,68,68,0.6)';
            nameInput.focus();
            setTimeout(() => nameInput.style.borderColor = '', 1500);
            return;
        }
        if (currentCount >= LIMIT) { checkLimit(); return; }

        uploadArea.style.display = 'none';
        nameArea.style.display = 'none';
        progress.style.display = 'block';
        if (progressTx) progressTx.textContent = 'Compressing your photo...';
        submitBtn.disabled = true;

        try {
            const compressed = await compressToWebP(selectedFile);
            if (progressTx) progressTx.textContent = 'Uploading...';

            const fd = new FormData();
            fd.append('file', compressed, 'guest-photo.webp');
            fd.append('event_id', WEDDING_CONFIG.eventId);
            fd.append('uploader_name', name);

            const res  = await fetch('/api/guest-photos/upload', { method: 'POST', body: fd });
            const json = await res.json();
            progress.style.display = 'none';

            if (!json.success) {
                if (json.limitReached) { checkLimit(); }
                else {
                    alert('Upload failed: ' + (json.error || 'Unknown error'));
                    uploadArea.style.display = '';
                    nameArea.style.display = 'block';
                }
                submitBtn.disabled = false;
                return;
            }

            selectedFile = null;
            fileInput.value = '';
            nameInput.value = '';
            nameArea.style.display = 'none';
            currentCount++;
            checkLimit();

            const toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(16,185,129,0.9);color:#fff;padding:12px 24px;border-radius:999px;font-size:0.9rem;font-weight:600;z-index:9999;';
            toast.textContent = '\uD83D\uDCF8 Your memory is now live!';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);

        } catch (err) {
            console.error('[GPW]', err);
            progress.style.display = 'none';
            uploadArea.style.display = '';
            nameArea.style.display = 'block';
            alert('Something went wrong. Please try again.');
        }
        submitBtn.disabled = false;
    });

    if (_supabase) {
        _supabase.channel(`guest-photos-${WEDDING_CONFIG.eventId}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'guest_photos',
                filter: `event_id=eq.${WEDDING_CONFIG.eventId}`
            }, (payload) => {
                if (payload.new && payload.new.approved) {
                    addPhotoCard(payload.new, false);
                    currentCount++;
                    checkLimit();
                }
            })
            .on('postgres_changes', {
                event: 'DELETE', schema: 'public', table: 'guest_photos',
                filter: `event_id=eq.${WEDDING_CONFIG.eventId}`
            }, (payload) => {
                const card = grid.querySelector(`[data-photo-id="${payload.old.id}"]`);
                if (card) { card.style.opacity = '0'; setTimeout(() => card.remove(), 300); currentCount--; checkLimit(); }
            })
            .subscribe();
    }

    loadPhotos();
})();
