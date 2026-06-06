const fs = require('fs');
const path = require('path');

const htmlPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Revert dividers
html = html.replace(/<div class="card-divider">◇<\/div>/g, '<div class="vertical-divider"><span class="divider-dot"></span></div>');

// Remove corner ornaments
html = html.replace(/<span class="corner-ornament[^>]+>.*?<\/span>/g, '');

fs.writeFileSync(htmlPath, html, 'utf8');

const cssPath = path.join('D:', 'Eventcast.pro', 'mubeena-ameerbasha-nikah', 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Revert details-card style
const origDetailsCardCSS = '.details-card{position:absolute;top:478px;left:48px;width:383px;height:104px;background-color:rgb(253, 251, 247);border:1px solid rgba(204, 167, 98, 0.45);border-radius:16px;padding:12px 10px;backdrop-filter:blur(5px);box-shadow:rgba(204, 167, 98, 0.12) 0px 8px 25px;display:flex;flex-direction:column;justify-content:center;}';
css = css.replace(/\.details-card\{[^}]*\}/, origDetailsCardCSS);

// Remove the appended ornament styles and card-divider
css = css.replace(/\.corner-ornament\{[^}]*\}/g, '');
css = css.replace(/\.corner-ornament\.top-left\{[^}]*\}/g, '');
css = css.replace(/\.corner-ornament\.top-right\{[^}]*\}/g, '');
css = css.replace(/\.corner-ornament\.bottom-left\{[^}]*\}/g, '');
css = css.replace(/\.corner-ornament\.bottom-right\{[^}]*\}/g, '');
css = css.replace(/\.card-divider\{[^}]*\}/g, '');

fs.writeFileSync(cssPath, css, 'utf8');
