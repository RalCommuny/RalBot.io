const DEFAULT_PREFIX = "!";

function isValidPrefix(prefix) {
  return typeof prefix === "string" && /^[!#$%&*+,\-.:;=?^_~]$/.test(prefix);
}

module.exports = { DEFAULT_PREFIX, isValidPrefix };
