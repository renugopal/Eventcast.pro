const fs = require('fs');
const path = require('path');

const htmlPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Add corner cuts for the exact mockup shape if they don't exist
if (!html.includes('corner-cut')) {
    html = html.replace(
        '<div id="i6puj" class="countdown-header">',
        '<div class="corner-cut top-left"></div><div class="corner-cut top-right"></div><div class="corner-cut bottom-left"></div><div class="corner-cut bottom-right"></div><div id="i6puj" class="countdown-header">'
    );
}
fs.writeFileSync(htmlPath, html, 'utf8');


const cssPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Ensure time-num is globally defined (it might have been wiped)
if (!css.includes('.time-num{font-family:"Cormorant')) {
    // Add it safely to the top before media queries
    css = css.replace(
        '.countdown-header{',
        '.time-num{font-family:"Cormorant Garamond", serif;font-size:42px;font-weight:400;color:#ffffff;line-height:1;}.countdown-header{'
    );
} else {
    // Or replace if it exists but is wrong
    css = css.replace(
        /\.time-num\{[^}]*\}/g,
        '.time-num{font-family:"Cormorant Garamond", serif;font-size:42px;font-weight:400;color:#ffffff;line-height:1;}'
    );
}

// Ensure the countdown card has the exact dark green, border, and the mosaic pattern
const mosaicPattern = "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0l2 12h12l-10 8 4 12-10-8-10 8 4-12-10-8h12z' fill='%23C8A96B' fill-opacity='0.03' fill-rule='evenodd'/%3E%3C/svg%3E\")";

css = css.replace(
    /\.countdown-card\{[^}]*\}/,
    '.countdown-card{position:absolute;top:587px;left:72px;width:347px;height:125px;background-color:#05251A;background-image:' + mosaicPattern + ';border:1px solid #C8A96B;padding:15px 15px 25px 15px;box-shadow:0 8px 25px rgba(0,0,0,0.3);display:flex;flex-direction:column;justify-content:center;position:relative;overflow:visible;}'
);

// Add corner-cut styles
if (!css.includes('.corner-cut')) {
    const cornerCutCSS = '.corner-cut{position:absolute;width:14px;height:14px;background-color:#fbf9f4;border:1px solid #C8A96B;border-radius:50%;z-index:10;}.corner-cut.top-left{top:-7px;left:-7px;border-color:transparent #C8A96B #C8A96B transparent;}.corner-cut.top-right{top:-7px;right:-7px;border-color:transparent transparent #C8A96B #C8A96B;}.corner-cut.bottom-left{bottom:-7px;left:-7px;border-color:#C8A96B #C8A96B transparent transparent;}.corner-cut.bottom-right{bottom:-7px;right:-7px;border-color:#C8A96B transparent transparent #C8A96B;}';
    css += cornerCutCSS;
}

// Adjust mobile media query if needed to make sure time-num scales well
css = css.replace(
    /@media \(max-width: 480px\)\{[^}]*\}/,
    '@media (max-width: 480px){.detail-label{font-size:11px;}.detail-value{font-size:20px;}.detail-subvalue{font-size:13px;}.time-num{font-size:32px;}.time-unit{min-width:40px;}}'
);

fs.writeFileSync(cssPath, css, 'utf8');
