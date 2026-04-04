// Web App Logic for Premium AI Workspace

const recordBtn = document.getElementById('record-btn');
const chatHistory = document.getElementById('chat-history');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const waveformCanvas = document.getElementById('waveform');
const ctx = waveformCanvas.getContext('2d');

let isRecording = false;
let mediaRecorder;
let audioChunks = [];
let animationId;
let webhookUrl = localStorage.getItem('ai_workspace_webhook') || '';

// Settings UI
document.querySelector('.settings-btn').addEventListener('click', () => {
    const url = prompt('Enter your Make.com Webhook URL:', webhookUrl);
    if (url !== null) {
        webhookUrl = url;
        localStorage.setItem('ai_workspace_webhook', url);
        addMessage('system', 'Webhook URL updated.');
    }
});

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

// Text Input Logic
sendBtn.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (text) {
        addMessage('user', text);
        textInput.value = '';
        processWithAI(text);
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
async function processWithAI(data) {
    if (!webhookUrl) {
        addMessage('system', '⚠️ Please set your Webhook URL in Settings first.');
        return;
    }

    addMessage('ai', 'Processing your request...');

    try {
        let body;
        let headers = {};

        if (typeof data === 'string') {
            // Sending Text
            body = JSON.stringify({ message: data, type: 'text' });
            headers['Content-Type'] = 'application/json';
        } else {
            // Sending Audio Blob
            const formData = new FormData();
            formData.append('audio', data, 'recording.wav');
            formData.append('type', 'audio');
            body = formData;
            // Fetch will automatically set content-type for FormData
        }

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: headers,
            body: body
        });

        if (response.ok) {
            const result = await response.text(); // Assuming Webhook Response returns text
            addMessage('ai', result || "Request sent successfully! Make.com processed it.");
            // If response contains code, update preview (optional)
        } else {
            addMessage('system', '❌ Error: Could not reach the Webhook.');
        }
    } catch (err) {
        console.error('Fetch error:', err);
        addMessage('system', '❌ Error: Connection failed. Check your Webhook URL.');
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
