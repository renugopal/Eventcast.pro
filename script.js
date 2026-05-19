/* =========================================
   Eventcast.pro | Main JavaScript
========================================= */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Sticky Navbar Effect
    const navbar = document.getElementById('navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(15, 23, 42, 0.95)'; /* Dark blue-black */
            navbar.style.boxShadow = '0 5px 20px rgba(0,0,0,0.3)';
        } else {
            navbar.style.background = 'var(--bg-glass)'; /* Initial dark transparent state */
            navbar.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.05)';
        }
    });

    // 2. Scroll Animations (Intersection Observer)
    const fadeElements = document.querySelectorAll('.fade-in, .slide-up');
    
    const observerOptions = {
        threshold: 0.15,
        rootMargin: "0px 0px -50px 0px"
    };

    const appearOnScroll = new IntersectionObserver(function(entries, observer) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) {
                return;
            } else {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    fadeElements.forEach(el => {
        appearOnScroll.observe(el);
    });

    // 3. Mobile Menu Toggle
    const mobileMenu = document.getElementById('mobile-menu');
    const navLinks = document.querySelector('.nav-links');
    
    // Very basic mobile menu toggle for demo
    mobileMenu.addEventListener('click', () => {
        if(navLinks.style.display === 'flex') {
            navLinks.style.display = 'none';
        } else {
            navLinks.style.display = 'flex';
            navLinks.style.flexDirection = 'column';
            navLinks.style.position = 'absolute';
            navLinks.style.top = '70px';
            navLinks.style.left = '0';
            navLinks.style.width = '100%';
            navLinks.style.background = 'var(--bg-dark)';
            navLinks.style.padding = '20px 0';
            navLinks.style.textAlign = 'center';
            navLinks.style.boxShadow = '0 10px 20px rgba(0,0,0,0.3)';
        }
    });

    // 4. Form Submission Handling
    const form = document.getElementById('enquiryForm');
    
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault(); // Prevent page reload
            
            const btn = document.querySelector('.book-now button');
            const originalText = btn.innerHTML;
            
            btn.innerHTML = 'Sending...';
            btn.style.opacity = '0.7';

            // Simulate form submission
            setTimeout(() => {
                btn.innerHTML = 'Sent Successfully!';
                btn.style.backgroundColor = 'green';
                btn.style.borderColor = 'green';
                btn.style.color = 'white';
                btn.style.opacity = '1';
                
                alert("Thank you! Your details have been received. Our team will call you shortly to discuss your event.");
                
                // Reset form
                form.reset();
                
                // Reset button after 3 seconds
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.backgroundColor = 'var(--primary-color)';
                    btn.style.borderColor = 'var(--primary-color)';
                }, 3000);
                
            }, 1000);
        });
    }

    // 5. AI Sales Bot & Cost-Savings Calculator
    const chatBtn = document.getElementById('ai-chat-btn');
    const chatWindow = document.getElementById('ai-chat-window');
    const closeChatBtn = document.getElementById('close-chat-btn');
    
    // Toggle Chat
    if (chatBtn && chatWindow && closeChatBtn) {
        chatBtn.addEventListener('click', () => {
            chatWindow.classList.remove('hidden');
            chatBtn.style.display = 'none';
        });
        
        closeChatBtn.addEventListener('click', () => {
            chatWindow.classList.add('hidden');
            chatBtn.style.display = 'flex';
        });
    }

    // Cost Calculator Logic
    const eventsSlider = document.getElementById('events-slider');
    const eventsVal = document.getElementById('events-val');
    const otherCost = document.getElementById('other-cost');
    const ecCost = document.getElementById('ec-cost');
    const totalSavings = document.getElementById('total-savings');

    if (eventsSlider) {
        eventsSlider.addEventListener('input', (e) => {
            const numEvents = parseInt(e.target.value);
            eventsVal.innerText = numEvents;
            
            // Typical generic platform / CDN cost per event for 1000 viewers: ₹3,000
            // Eventcast Pro Cost: ₹499
            const otherTotal = numEvents * 3000;
            const ecTotal = numEvents * 499;
            const savings = otherTotal - ecTotal;
            
            otherCost.innerText = otherTotal.toLocaleString('en-IN');
            ecCost.innerText = ecTotal.toLocaleString('en-IN');
            totalSavings.innerText = savings.toLocaleString('en-IN');
        });
    }

    // AI Chat Logic
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const messagesContainer = document.getElementById('chat-messages');
    
    let chatHistory = [
        { role: 'model', content: "Hello! I'm the Eventcast AI. Use the calculator above to see your savings, or ask me how we can upgrade your livestreaming business! 🚀" }
    ];

    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const userText = chatInput.value.trim();
            if (!userText) return;

            // 1. Add user message to UI
            appendMessage('user', userText);
            chatInput.value = '';
            
            // 2. Add loading state
            const loadingId = 'loading-' + Date.now();
            appendMessage('model', '...', loadingId);

            chatHistory.push({ role: 'user', content: userText });

            try {
                // Determine API URL based on host (local vs production)
                // Point directly to our live Cloudflare Pages URL for immediate CORS fallback support!
                const isLocal = window.location.hostname === 'localhost' || 
                                window.location.hostname === '127.0.0.1' || 
                                window.location.hostname === 'localhost:3000';
                
                const apiUrl = isLocal
                    ? 'http://localhost:3000/api/ai/sales-chat'
                    : 'https://eventcast-admin.pages.dev/api/ai/sales-chat';

                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: chatHistory })
                });

                const data = await res.json();
                
                // Remove loading message
                document.getElementById(loadingId)?.remove();

                if (data.success) {
                    appendMessage('model', data.reply);
                    chatHistory.push({ role: 'model', content: data.reply });
                } else {
                    appendMessage('model', 'Oops, I had a small connection issue. Please try again!');
                }
            } catch (err) {
                console.error(err);
                document.getElementById(loadingId)?.remove();
                appendMessage('model', 'Oops, I am unable to reach the server right now.');
            }
        });
    }

    function appendMessage(role, text, id = null) {
        if (!messagesContainer) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role === 'user' ? 'user-message' : 'ai-message'}`;
        if (id) msgDiv.id = id;
        
        // Convert markdown bold and line breaks to basic HTML (simple parser)
        let htmlText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        htmlText = htmlText.replace(/\n/g, '<br>');
        
        msgDiv.innerHTML = htmlText;
        messagesContainer.appendChild(msgDiv);
        
        // Auto scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
});
