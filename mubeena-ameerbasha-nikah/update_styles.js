const fs = require('fs');
const path = require('path');

const htmlPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Fix the corrupted diamond divider and replace with floral motif or diamond
html = html.replace(/<div class="card-divider">\?<\/div>/g, '<div class="card-divider">◇</div>');

// Add corner flourishes to the details-card if they don't exist yet
if (!html.includes('corner-ornament')) {
    html = html.replace(
        '<div class="details-grid">',
        '<span class="corner-ornament top-left">❈</span><span class="corner-ornament top-right">❈</span><span class="corner-ornament bottom-left">❈</span><span class="corner-ornament bottom-right">❈</span><div class="details-grid">'
    );
}

fs.writeFileSync(htmlPath, html, 'utf8');

const cssPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Update details-card styles
const newDetailsCardCSS = '.details-card{position:absolute;top:478px;left:48px;width:383px;height:104px;background-color:#FBF8F2;border:1px solid #C8A96B;border-radius:24px;padding:12px 10px;box-shadow:0 8px 24px rgba(0,0,0,0.06);display:flex;flex-direction:column;justify-content:center;position:relative;}';
css = css.replace(/\.details-card\{[^}]*\}/, newDetailsCardCSS);

// Add corner ornament styles
if (!css.includes('.corner-ornament')) {
    const ornamentCSS = '.corner-ornament{position:absolute;color:#C8A96B;font-size:10px;line-height:1;}.corner-ornament.top-left{top:6px;left:8px;}.corner-ornament.top-right{top:6px;right:8px;}.corner-ornament.bottom-left{bottom:6px;left:8px;}.corner-ornament.bottom-right{bottom:6px;right:8px;}';
    css += ornamentCSS;
}

// Add card-divider styles
if (!css.includes('.card-divider')) {
    const dividerCSS = '.card-divider{color:#C8A96B;font-size:10px;display:flex;align-items:center;justify-content:center;opacity:0.7;margin:0 4px;}';
    css += dividerCSS;
}

fs.writeFileSync(cssPath, css, 'utf8');
