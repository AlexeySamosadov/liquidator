const fs = require('fs');
const path = require('path');

const contractsPath = path.join(__dirname, '../../node_modules/@gmx-io/sdk/build/cjs/src/configs/contracts.js');
const content = fs.readFileSync(contractsPath, 'utf8');

// Find ARBITRUM section (42161)
// The file uses [ARBITRUM] where ARBITRUM is imported.
// We need to find the value of ARBITRUM variable first? No, we can assume it's 42161.
// But the keys are dynamic.
// Let's look for the structure.

console.log('Reading contracts.js...');

// Regex to find SyntheticsReader in the file
// It looks like: SyntheticsReader: "0x..."
const matches = content.matchAll(/SyntheticsReader:\s*"0x[a-fA-F0-9]{40}"/g);
for (const match of matches) {
    console.log('Found:', match[0]);
}

// Try to find DataStore
const dsMatches = content.matchAll(/DataStore:\s*"0x[a-fA-F0-9]{40}"/g);
for (const match of dsMatches) {
    console.log('Found:', match[0]);
}

