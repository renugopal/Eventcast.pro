const fs = require('fs');
const path = require('path');

const htmlPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Add Bodoni Moda to Google Fonts if missing
if (!html.includes('Bodoni+Moda')) {
    html = html.replace(
        'family=Cormorant+Garamond',
        'family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900&family=Cormorant+Garamond'
    );
}

// Remove corner cuts
html = html.replace(/<div class="corner-cut[^>]+><\/div>/g, '');

// Remove mosque-silhouette
html = html.replace(/<div class="mosque-silhouette">[\s\S]*?<\/svg><\/div>/g, '');

fs.writeFileSync(htmlPath, html, 'utf8');

const cssPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Update countdown-card to use the empty image
css = css.replace(
    /\.countdown-card\{[^}]*\}/,
    '.countdown-card{position:absolute;top:598px;left:48px;width:383px;height:125px;background-image:url("countdown-bg.png");background-size:100% 100%;background-repeat:no-repeat;background-color:transparent;border:none;border-radius:0;padding:25px 15px 15px 15px;box-shadow:0 10px 30px rgba(0,0,0,0.15);display:flex;flex-direction:column;justify-content:center;}'
);

// Hide countdown-header
css = css.replace(
    /\.countdown-header\{[^}]*\}/,
    '.countdown-header{display:none;}'
);

// Hide countdown-divider
css = css.replace(
    /\.countdown-divider\{[^}]*\}/,
    '.countdown-divider{display:none;}'
);

// Update time-num for Bodoni Moda SemiBold
css = css.replace(
    /\.time-num\{[^}]*\}/g,
    '.time-num{font-family:"Bodoni Moda", serif;font-size:38px;font-weight:600;color:#ffffff;line-height:1;}'
);

// Update time-label size slightly to match
css = css.replace(
    /\.time-label\{[^}]*\}/g,
    '.time-label{font-family:"Montserrat", sans-serif;font-size:10px;font-weight:600;letter-spacing:1px;color:#C8A96B;margin-top:6px;}'
);

// Remove corner-cut styles
css = css.replace(/\.corner-cut\{[^}]*\}/g, '');
css = css.replace(/\.corner-cut\.top-left\{[^}]*\}/g, '');
css = css.replace(/\.corner-cut\.top-right\{[^}]*\}/g, '');
css = css.replace(/\.corner-cut\.bottom-left\{[^}]*\}/g, '');
css = css.replace(/\.corner-cut\.bottom-right\{[^}]*\}/g, '');

// Update mobile media query
css = css.replace(
    /@media \(max-width: 480px\)\{[^}]*\}/,
    '@media (max-width: 480px){.detail-label{font-size:11px;}.detail-value{font-size:20px;}.detail-subvalue{font-size:13px;}.time-num{font-size:28px;}.time-unit{min-width:40px;}}'
);

fs.writeFileSync(cssPath, css, 'utf8');
