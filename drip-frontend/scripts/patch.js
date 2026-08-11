const fs = require('fs');
const path = require('path');

// Read files
const pagePath = path.resolve(__dirname, '../app/page.tsx');
let content = fs.readFileSync(pagePath, 'utf8');
const lines = content.split('\n');

// Find the Wave surface comment line
const waveIdx = lines.findIndex(l => l.includes('Wave surface'));
if (waveIdx < 0) { console.error('Could not find Wave surface'); process.exit(1); }
console.log('Wave surface found at line', waveIdx + 1);

// Read the NumInput snippet
const snippet = fs.readFileSync(path.resolve(__dirname, 'numinput.tsx'), 'utf8');

// Splice snippet lines before waveIdx
const snippetLines = snippet.split('\n');
lines.splice(waveIdx, 0, ...snippetLines);

fs.writeFileSync(pagePath, lines.join('\n'), 'utf8');
console.log('Done. NumInput inserted. File has', lines.length, 'lines.');
