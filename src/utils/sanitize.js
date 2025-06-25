
function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\s+/g, ' ') // Replace multiple whitespace chars with a single space
    .trim();
}

module.exports = { sanitize };
