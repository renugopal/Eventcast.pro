const fs = require('fs');
const path = require('path');

const htmlPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Insert lantern lights if they don't exist
if (!html.includes('lantern-light left')) {
    html = html.replace(
        '<div class="hero-content">',
        '<div class="hero-content">\n<div class="lantern-light left"></div>\n<div class="lantern-light right"></div>'
    );
    fs.writeFileSync(htmlPath, html, 'utf8');
}

const cssPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

if (!css.includes('.lantern-light')) {
    const lightCSS = `
.lantern-light {
    position: absolute;
    width: 90px;
    height: 90px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 215, 0, 0.6) 0%, rgba(255, 165, 0, 0.2) 40%, rgba(255, 215, 0, 0) 70%);
    mix-blend-mode: screen;
    animation: lantern-glow 2.5s ease-in-out infinite alternate;
    pointer-events: none;
    z-index: 10;
}
.lantern-light.left {
    top: 35px;
    left: 20px;
    animation-delay: 0s;
}
.lantern-light.right {
    top: 35px;
    right: 20px;
    animation-delay: 1.2s;
}
@keyframes lantern-glow {
    0% { opacity: 0.4; transform: scale(0.85); }
    100% { opacity: 1; transform: scale(1.15); }
}
`;
    css += lightCSS;
    fs.writeFileSync(cssPath, css, 'utf8');
}
