const SLUG = 'ramakrishna-radhika-wedding';
const url = `https://eventcast.pro/events/${SLUG}`;

const html = await fetch(url).then((r) => r.text());

const checks = {
  groom: html.includes('Rama Krishna'),
  bride: html.includes('Radhika'),
  date: html.includes('July 2'),
  time: html.includes('1:45 AM'),
  timeSubtext: html.includes('(early hours of 3rd)'),
  venue: html.includes('Parvathi Parameswara'),
  noInvitation: !html.includes('main-invitation-video') || html.includes("getElementById('invitation-video')"),
  gallery: (html.match(/gallery-img/g) || []).length >= 3,
  seoTitle: html.includes('Rama Krishna') && html.includes('Wedding Live'),
  initials: html.includes('R & R'),
  guestPhotoWall: html.includes('guest-photo') || html.includes('guestPhotoWallEnabled: true'),
  loaderPhoto: html.includes('loaderPhotoUrl') && html.includes('seo_thumbnail'),
  mapEmbed: html.includes('Parvathi%20Parameswara%20Kalyana%20Mandapam'),
  timerTarget: html.includes('2026-07-03T01:45'),
};

console.log('Page:', url);
for (const [k, v] of Object.entries(checks)) {
  console.log(v ? '✓' : '✗', k);
}

const fails = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
if (fails.length) {
  console.error('\nFailed:', fails.join(', '));
  process.exit(1);
}
console.log('\nAll checks passed.');
