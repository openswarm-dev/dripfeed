const fs = require('fs');
const path = require('path');

const pagePath = path.resolve(__dirname, '../app/page.tsx');
let content = fs.readFileSync(pagePath, 'utf8');
const lines = content.split('\n');

// Find CreateCampaignModal function start and end
let funcStart = -1, funcEnd = -1, depth = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('function CreateCampaignModal')) {
    funcStart = i;
  }
  if (funcStart >= 0) {
    for (const c of lines[i]) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth === 0 && i > funcStart) {
      funcEnd = i;
      break;
    }
  }
}

console.log(`CreateCampaignModal: lines ${funcStart+1} - ${funcEnd+1}`);

// Read replacement
const replacement = fs.readFileSync(path.resolve(__dirname, 'create_campaign_modal.tsx'), 'utf8');
const replLines = replacement.split('\n');

// Splice: remove old function, insert new
lines.splice(funcStart, funcEnd - funcStart + 1, ...replLines);

fs.writeFileSync(pagePath, lines.join('\n'), 'utf8');
console.log('Done. File now has', lines.length, 'lines.');
