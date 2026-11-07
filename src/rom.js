const fs = require('node:fs');
const { parseINESBytes } = require('./ines');

function parseINES(filePath) {
  const rom = fs.readFileSync(filePath);
  return parseINESBytes(rom);
}

module.exports = {
  parseINES,
  parseINESBytes,
};
