const recordBtn = document.getElementById('record-btn');
const chatHistory = document.getElementById('chat-history');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const waveformCanvas = document.getElementById('waveform');
const ctx = waveformCanvas.getContext('2d');
const fileInput = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const filePreview = document.getElementById('file-preview');

let isRecording = false;
let mediaRecorder;
let audioChunks = [];
let animationId;
let webhookUrl = localStorage.getItem('ai_workspace_webhook') || '';
let selectedFiles = [];

// Settings UI
document.querySelector('.settings-btn').addEventListener('click', () => {
    const url = prompt('Enter your Make.com Webhook URL:', webhookUrl);
    if (url !== null) {
        webhookUrl = url;
        localStorage.setItem('ai_workspace_webhook', url);
        addMessage('system', 'Webhook URL updated.');
    }
});

// File Attachment Logic
attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    selectedFiles = [...selectedFiles, ...files];
    renderPreviews();
});

function renderPreviews() {
    filePreview.innerHTML = '';
    selectedFiles.forEach((file, index) => {
        const reader = new FileReader();
        const item = document.createElement('div');
        item.className = 'preview-item';

        if (file.type.startsWith('image/')) {
            reader.onload = (e) => {
                const img = document.createElement('img');
                img.src = e.target.result;
                item.appendChild(img);
            };
            reader.readAsDataURL(file);
        } else {
            const icon = document.createElement('div');
            icon.innerText = '📄';
            icon.style.textAlign = 'center';
            icon.style.lineHeight = '60px';
            item.appendChild(icon);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerText = '×';
        removeBtn.onclick = () => {
            selectedFiles.splice(index, 1);
            renderPreviews();
        };
        item.appendChild(removeBtn);
        filePreview.appendChild(item);
    });
}

// Waveform Animation (Mock)
function drawWaveform() {
    ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    ctx.beginPath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;

    const centerY = waveformCanvas.height / 2;
    for (let i = 0; i < waveformCanvas.width; i++) {
        const amplitude = isRecording ? Math.random() * 20 : 2;
        ctx.lineTo(i, centerY + Math.sin(i * 0.05 + Date.now() * 0.01) * amplitude);
    }
    ctx.stroke();
    animationId = requestAnimationFrame(drawWaveform);
}

drawWaveform();

// Voice Recording Logic
recordBtn.addEventListener('click', async () => {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                addMessage('user', '🎤 Voice message sent...');
                // Here we would send the audioBlob to the Make.com Webhook
                processWithAI(audioBlob);
            };

            mediaRecorder.start();
            isRecording = true;
            recordBtn.classList.add('recording');
            recordBtn.querySelector('.btn-text').innerText = 'Stop Recording';
        } catch (err) {
            console.error('Microphone access denied:', err);
            alert('Please allow microphone access to record voice.');
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        recordBtn.classList.remove('recording');
        recordBtn.querySelector('.btn-text').innerText = 'Record Voice';
    }
});

// Text/File Input Logic
sendBtn.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (text || selectedFiles.length > 0) {
        addMessage('user', text || 'Sent files and media...');
        processWithAI(text, selectedFiles);
        textInput.value = '';
        selectedFiles = [];
        renderPreviews();
    }
});

// Interface Functions
function addMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', sender);
    msgDiv.innerText = text;
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// AI Processing with real Webhook connection
async function processWithAI(textData, files = []) {
    if (!webhookUrl) {
        addMessage('system', '⚠️ Please set your Webhook URL in Settings first.');
        return;
    }

    addMessage('ai', 'Processing your request...');

    try {
        const formData = new FormData();

        if (typeof textData === 'object' && textData instanceof Blob) {
            // Audio from MediaRecorder
            formData.append('audio', textData, 'recording.wav');
            formData.append('type', 'audio');
        } else {
            // Text and Files
            formData.append('message', textData || '');
            formData.append('type', 'hybrid');
            files.forEach((file, index) => {
                formData.append(`file_${index}`, file);
            });
        }

        const response = await fetch(webhookUrl, {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const result = await response.text();
            addMessage('ai', result || "Request processed successfully!");
        } else {
            addMessage('system', '❌ Error: Could not reach the Webhook.');
        }
    } catch (err) {
        console.error('Fetch error:', err);
        addMessage('system', '❌ Error: Connection failed.');
    }
}

function updateCodePreview() {
    const codeDisplay = document.getElementById('code-display');
    codeDisplay.innerText = `
// Generated React Component
const InteractiveCard = () => {
  return (
    <div className="p-6 bg-slate-800 rounded-xl shadow-xl">
      <h3 className="text-xl font-bold text-blue-400">AI Design</h3>
      <p className="text-slate-400">Created with Gemini-Claude Pipeline</p>
    </div>
  );
};
    `.trim();
}

// Tab Switching
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelector('.nav-item.active').classList.remove('active');
        btn.classList.add('active');
        // Handle view changes here
    });
});
