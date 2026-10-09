const UNITS_IN_SECONDS = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
};

const MAX_DURATION_SECONDS = 365 * 24 * 60 * 60;

function parseDuration(input) {
  if (typeof input !== "string") {
    throw new TypeError("Duration must be a string.");
  }

  const match = /^([1-9]\d*)(s|m|h|d|w)$/i.exec(input.trim());
  if (!match) {
    throw new Error("Use a duration such as 30m, 2h, 7d, or 1w.");
  }

  const amount = Number(match[1]);
  const seconds = amount * UNITS_IN_SECONDS[match[2].toLowerCase()];
  if (!Number.isSafeInteger(seconds) || seconds > MAX_DURATION_SECONDS) {
    throw new Error("The duration must be no longer than 365 days.");
  }

  return seconds;
}

module.exports = { parseDuration };
