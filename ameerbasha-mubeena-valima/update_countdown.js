const fs = require('fs');
const path = require('path');

const htmlPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Update header text in HTML
html = html.replace(
    '<span class="countdown-title">✣ EVENT STARTS IN ✣</span>',
    '<span class="countdown-title">↠ EVENT STARTS IN ↞</span>'
);

fs.writeFileSync(htmlPath, html, 'utf8');

const cssPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Replace countdown-card
css = css.replace(
    /\.countdown-card\{[^}]*\}/,
    '.countdown-card{position:absolute;top:587px;left:72px;width:347px;height:125px;background-color:#05251A;border:1px solid #C8A96B;border-radius:12px;padding:15px 15px 25px 15px;box-shadow:0 8px 25px rgba(0,0,0,0.3);display:flex;flex-direction:column;justify-content:center;position:relative;}'
);

// Replace countdown-title
css = css.replace(
    /\.countdown-title\{[^}]*\}/,
    '.countdown-title{font-family:"Montserrat", sans-serif;color:#C8A96B;font-size:12px;letter-spacing:2px;font-weight:600;text-align:center;margin-bottom:12px;}'
);

// Replace time-num
css = css.replace(
    /\.time-num\{[^}]*\}/g,
    '.time-num{font-family:"Cormorant Garamond", serif;font-size:42px;font-weight:400;color:#ffffff;line-height:1;}'
);

// Replace time-label
css = css.replace(
    /\.time-label\{[^}]*\}/g,
    '.time-label{font-family:"Montserrat", sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#C8A96B;margin-top:6px;}'
);

// Replace countdown-divider
css = css.replace(
    /\.countdown-divider\{[^}]*\}/,
    '.countdown-divider{width:1px;height:45px;background-color:#C8A96B;opacity:0.6;}'
);

// Replace mosque-silhouette
css = css.replace(
    /\.mosque-silhouette\{[^}]*\}/,
    '.mosque-silhouette{position:absolute;bottom:0px;left:calc(50% - 60px);width:120px;height:25px;opacity:1;pointer-events:none;z-index:1;}'
);

fs.writeFileSync(cssPath, css, 'utf8');
