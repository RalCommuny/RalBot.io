const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDuration } = require("../src/duration");
const { DEFAULT_PREFIX, isValidPrefix } = require("../src/prefix");
const { EMOJI_CONFIG, makeEmbedPayload, resolveEmoji } = require("../src/emojis");

test("parses supported duration units", () => {
  assert.equal(parseDuration("30m"), 1800);
  assert.equal(parseDuration("2H"), 7200);
  assert.equal(parseDuration("7d"), 604800);
  assert.equal(parseDuration("1w"), 604800);
});

test("rejects invalid and out-of-range durations", () => {
  for (const input of ["0m", "-1h", "2 hours", "5x", "366d", ""]) {
    assert.throws(() => parseDuration(input), { name: "Error" });
  }
});

test("validates one-character server prefixes", () => {
  assert.equal(DEFAULT_PREFIX, "!");
  for (const prefix of ["!", "%", "?", "+"]) {
    assert.equal(isValidPrefix(prefix), true);
  }
  for (const prefix of ["", "ab", "/", " ", "@", "`"]) {
    assert.equal(isValidPrefix(prefix), false);
  }
});

test("resolves custom emoji using Discord's cached emoji data", () => {
  const emojis = new Map(
    Object.entries(EMOJI_CONFIG).map(([name, emoji]) => [
      emoji.id,
      { toString: () => `<a:${name}:${emoji.id}>` },
    ]),
  );
  const client = {
    guilds: {
      cache: new Map([
        ["emoji-server", { emojis: { cache: emojis } }],
      ]),
    },
  };

  for (const name of Object.keys(EMOJI_CONFIG).filter((key) => EMOJI_CONFIG[key].id)) {
    const emoji = resolveEmoji(client, name);
    assert.match(emoji, /^<a:[a-zA-Z0-9_]{2,32}:\d{17,20}>$/);
  }
  assert.equal(resolveEmoji(client, "clock"), "⏰");
});

test("falls back cleanly when the bot cannot access a custom emoji", () => {
  const client = { guilds: { cache: new Map() } };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(resolveEmoji(client, "ban"), "🔨");
  } finally {
    console.warn = originalWarn;
  }
});

test("replaces external custom emojis when the bot lacks the channel permission", () => {
  const embed = {
    toJSON: () => ({
      title: "<a:ban:15567168776418570> Baneo",
      fields: [{ name: "<a:note:15567194307537026>", value: "Nota guardada" }],
    }),
  };
  const context = {
    guild: {
      emojis: { cache: new Map() },
      members: { me: { permissionsIn: () => ({ has: () => false }) } },
    },
    channel: {},
  };

  const result = makeEmbedPayload(embed, context);
  assert.equal(result.title, "🔨 Baneo");
  assert.equal(result.fields[0].name, "📝");
});

test("keeps external custom emoji markup when channel permission exists", () => {
  const embed = {
    toJSON: () => ({ title: "<a:ban:15567168776418570> Baneo" }),
  };
  const context = {
    guild: {
      emojis: { cache: new Map() },
      members: { me: { permissionsIn: () => ({ has: () => true }) } },
    },
    channel: {},
  };

  assert.equal(
    makeEmbedPayload(embed, context).title,
    "<a:ban:15567168776418570> Baneo",
  );
});

test("handles contexts without a cached guild member or emoji collection", () => {
  const embed = {
    toJSON: () => ({ title: "<a:ban:15567168776418570> Baneo" }),
  };
  assert.equal(
    makeEmbedPayload(embed, { guild: {}, channel: null }).title,
    "🔨 Baneo",
  );
  assert.equal(
    makeEmbedPayload(embed, { guild: null, channel: null }).title,
    "🔨 Baneo",
  );
});

test("accepts an already serialized embed payload", () => {
  const payload = { title: "Embed already serialized" };
  assert.deepEqual(makeEmbedPayload(payload, {}), payload);
});
