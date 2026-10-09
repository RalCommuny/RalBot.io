const { PermissionFlagsBits } = require("discord.js");

const EMOJI_CONFIG = {
  warning: { id: "15567168945194547", fallback: "⚠️" },
  ban: { id: "15567168776418570", fallback: "🔨" },
  shield: { id: "155671699235717231", fallback: "🛡️" },
  clock: { id: null, fallback: "⏰" },
  note: { id: "15567194307537026", fallback: "📝" },
  success: { id: "15567168277391222", fallback: "✅" },
  error: { id: "15567168945194547", fallback: "⚠️" },
  moderation: { id: "155671691305425700", fallback: "✨" },
};

const warnedMissingEmojis = new Set();

function findEmoji(client, id) {
  for (const guild of client.guilds.cache.values()) {
    const emoji = guild.emojis.cache.get(id);
    if (emoji) {
      return { emoji, guildId: guild.id };
    }
  }
  return null;
}

function resolveEmoji(client, name) {
  const config = EMOJI_CONFIG[name];
  if (!config) {
    throw new Error(`Unknown custom emoji: ${name}`);
  }
  if (!config.id) {
    return config.fallback;
  }

  const found = findEmoji(client, config.id);
  if (found) {
    return found.emoji.toString();
  }

  if (!warnedMissingEmojis.has(config.id)) {
    warnedMissingEmojis.add(config.id);
    console.warn(
      `Custom emoji ${name} (${config.id}) is unavailable. ` +
        "Check that the bot is in the emoji's source server and that the ID is correct.",
    );
  }
  return config.fallback;
}

function makeEmbedPayload(embed, context) {
  const payload = typeof embed?.toJSON === "function" ? embed.toJSON() : embed;
  const guild = context.guild;
  const channel = context.channel;
  const localEmojiIds = new Set(guild?.emojis?.cache?.keys?.() || []);
  const botMember = guild?.members?.me;
  const channelPermissions =
    botMember && channel && typeof botMember.permissionsIn === "function"
      ? botMember.permissionsIn(channel)
      : null;
  const canUseExternal =
    channelPermissions?.has?.(PermissionFlagsBits.UseExternalEmojis) ?? false;
  const configById = new Map();
  for (const config of Object.values(EMOJI_CONFIG)) {
    if (config.id && !configById.has(config.id)) {
      configById.set(config.id, config);
    }
  }

  function replaceUnavailableEmojis(value) {
    if (typeof value === "string") {
      return value.replace(/<a?:[a-zA-Z0-9_]+:(\d+)>/g, (markup, id) => {
        const config = configById.get(id);
        if (!config || localEmojiIds.has(id) || canUseExternal) {
          return markup;
        }
        return config.fallback;
      });
    }
    if (Array.isArray(value)) {
      return value.map(replaceUnavailableEmojis);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, replaceUnavailableEmojis(child)]),
      );
    }
    return value;
  }

  return replaceUnavailableEmojis(payload);
}

module.exports = { EMOJI_CONFIG, findEmoji, makeEmbedPayload, resolveEmoji };
