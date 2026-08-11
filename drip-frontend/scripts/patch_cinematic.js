const fs = require('fs');
const path = require('path');

const pagePath = path.resolve(__dirname, '../app/page.tsx');
let content = fs.readFileSync(pagePath, 'utf8');
const lines = content.split('\n');

// Find the Landing function line
const landingIdx = lines.findIndex(l => l.includes('function Landing('));
if (landingIdx < 0) { console.error('Landing not found'); process.exit(1); }
console.log('Inserting CinematicIntro before line', landingIdx + 1);

const snippet = fs.readFileSync(path.resolve(__dirname, 'cinematic.tsx'), 'utf8');
lines.splice(landingIdx, 0, snippet);

fs.writeFileSync(pagePath, lines.join('\n'), 'utf8');
console.log('Done. File now has', lines.length, 'lines.');
