/* =========================================
   Eventcast.pro | Main JavaScript
========================================= */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Sticky Navbar Effect
    const navbar = document.getElementById('navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(253, 250, 246, 0.95)';
            navbar.style.boxShadow = '0 5px 20px rgba(0,0,0,0.1)';
        } else {
            navbar.style.background = 'rgba(253, 250, 246, 0.85)';
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
            navLinks.style.background = '#fdfaf6';
            navLinks.style.padding = '20px 0';
            navLinks.style.textAlign = 'center';
            navLinks.style.boxShadow = '0 10px 20px rgba(0,0,0,0.1)';
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
});
