const {
  Client,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  ApplicationIntegrationType,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const database = require("./database");
const { parseDuration } = require("./duration");
const { isValidPrefix } = require("./prefix");
const { EMOJI_CONFIG, makeEmbedPayload, resolveEmoji } = require("./emojis");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
let checkingExpiredBans = false;
const customEmojis = new Proxy({}, {
  get: (_target, name) => resolveEmoji(client, name),
});

const slashCommandBuilders = [
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Banea a un usuario, opcionalmente por tiempo limitado.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario que será baneado.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("tiempo").setDescription("Duración, por ejemplo 30m, 2h o 7d."),
    )
    .addStringOption((option) =>
      option.setName("razon").setDescription("Motivo del baneo.").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Registra una advertencia para un usuario.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario advertido.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("razon").setDescription("Motivo de la advertencia.").setRequired(true).setMaxLength(500),
    )
    .addAttachmentOption((option) =>
      option.setName("imagen").setDescription("Imagen opcional para incluir en el aviso."),
    ),
  new SlashCommandBuilder()
    .setName("warnsee")
    .setDescription("Muestra las advertencias de un usuario.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario que quieres consultar.").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("removewarns")
    .setDescription("Quita una cantidad de advertencias recientes a un usuario.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario al que quitar advertencias.").setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName("cantidad").setDescription("Cantidad de advertencias (1-50).").setRequired(true).setMinValue(1).setMaxValue(50),
    ),
  new SlashCommandBuilder()
    .setName("seenotes")
    .setDescription("Muestra las notas recientes de un usuario.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario que quieres consultar.").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("createnote")
    .setDescription("Guarda una nota del equipo sobre un usuario.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario al que corresponde la nota.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("nota").setDescription("Contenido de la nota.").setRequired(true).setMaxLength(1000),
    )
    .addAttachmentOption((option) =>
      option.setName("imagen").setDescription("Imagen opcional de la nota."),
    ),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Quita el ban de un usuario.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario al que desbanear.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("razon").setDescription("Motivo del desbaneo.").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("modifyprefix")
    .setDescription("Cambia el prefijo de comandos de este servidor.")
    .addStringOption((option) =>
      option.setName("prefijo").setDescription("Un símbolo, por ejemplo %").setRequired(true).setMaxLength(1),
    ),
  new SlashCommandBuilder().setName("help").setDescription("Muestra los comandos de RalBot."),
];

const guildSlashCommands = slashCommandBuilders.map((command) => {
  const json = command
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .toJSON();
  delete json.contexts;
  delete json.integration_types;
  return json;
});

function makeEmbed(title, description, color = 0xd9c2ff) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description);
}

async function replyEmbed(message, embed) {
  embed.setFooter({ text: `RalBot ✦ ${message.author.username} · ${message.createdAt.toLocaleString("es-ES")}` });
  embed.setTimestamp(message.createdAt);
  await message.reply({ embeds: [makeEmbedPayload(embed, message)] });
}

async function sendUserNotice(user, embed, components = []) {
  try {
    await user.send({
      embeds: [makeEmbedPayload(embed, { guild: null, channel: null })],
      components,
    });
    return true;
  } catch (error) {
    console.warn(`No se pudo enviar un DM a ${user.id}:`, error);
    return false;
  }
}

function addNoticeResult(embed, sent) {
  embed.addFields({
    name: "Aviso por mensaje privado",
    value: sent ? "Enviado correctamente." : "No se pudo enviar; puede tener los mensajes privados cerrados.",
  });
  return embed;
}

function appealButtons(appealId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`appeal:request:${appealId}`)
        .setLabel("Apelar ban")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function ownerAppealButtons(appealId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`appeal:approve:${appealId}`)
        .setLabel("Aceptar y desbanear")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`appeal:reject:${appealId}`)
        .setLabel("Rechazar")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function notifyOwnerAboutAppeal(appeal, appellant) {
  const guild = await client.guilds.fetch(appeal.guildId);
  const owner = await client.users.fetch(guild.ownerId);
  await owner.send({
    embeds: [
      makeEmbed(
        "Solicitud de apelación de ban",
        `**Servidor:** ${guild.name}\n**Usuario:** ${appellant} (${appellant.tag})\n` +
          `El usuario solicita que revises su ban. Puedes aprobar el desbaneo o rechazar la solicitud.`,
        0xd9c2ff,
      ),
    ],
    components: ownerAppealButtons(appeal.id),
  });
}

async function handleButtonInteraction(interaction) {
  const match = /^appeal:(request|approve|reject):(\d+)$/.exec(interaction.customId);
  if (!match) {
    return;
  }
  const [, action, rawId] = match;
  const appealId = Number(rawId);
  const appeal = database.getAppeal(appealId);
  if (!appeal) {
    await interaction.reply({ content: "Esta solicitud ya no existe.", ephemeral: true });
    return;
  }

  if (action === "request") {
    if (interaction.user.id !== appeal.userId) {
      await interaction.reply({ content: "Esta apelación no te pertenece.", ephemeral: true });
      return;
    }
    if (appeal.status !== "waiting") {
      await interaction.reply({ content: "Esta apelación ya fue enviada o revisada.", ephemeral: true });
      return;
    }
    if (!database.updateAppealStatus(appealId, "waiting", "notifying")) {
      await interaction.reply({ content: "La solicitud ya se está procesando.", ephemeral: true });
      return;
    }

    try {
      await notifyOwnerAboutAppeal(appeal, interaction.user);
      database.updateAppealStatus(appealId, "notifying", "appealed");
      await interaction.update({
        content: "Tu apelación se envió al dueño del servidor para que la revise.",
        embeds: interaction.message.embeds,
        components: [],
      });
    } catch (error) {
      database.updateAppealStatus(appealId, "notifying", "waiting");
      console.error(`No se pudo enviar la apelación ${appealId} al dueño:`, error);
      await interaction.reply({
        content: "No se pudo avisar al dueño. Revisa si tiene los mensajes privados habilitados e inténtalo más tarde.",
        ephemeral: true,
      });
    }
    return;
  }

  const guild = await client.guilds.fetch(appeal.guildId);
  if (interaction.user.id !== guild.ownerId) {
    await interaction.reply({ content: "Solo el dueño del servidor puede revisar esta apelación.", ephemeral: true });
    return;
  }
  if (appeal.status !== "appealed") {
    await interaction.reply({ content: "Esta apelación ya fue revisada o no está pendiente.", ephemeral: true });
    return;
  }
  if (!database.updateAppealStatus(appealId, "appealed", "processing")) {
    await interaction.reply({ content: "La apelación ya se está procesando.", ephemeral: true });
    return;
  }

  try {
    if (action === "approve") {
      try {
        await guild.members.unban(appeal.userId, "Apelación aprobada por el dueño del servidor.");
      } catch (error) {
        if (error.code !== 10026) {
          throw error;
        }
      }
      database.removeScheduledBan(appeal.guildId, appeal.userId);
      database.updateAppealStatus(appealId, "processing", "approved");
      const appellant = await client.users.fetch(appeal.userId);
      await sendUserNotice(
        appellant,
        makeEmbed("Apelación aprobada", `El dueño de **${guild.name}** aprobó tu solicitud y quitó tu ban.`, 0xc8f7dc),
      );
      await interaction.update({
        content: `Apelación aprobada. <@${appeal.userId}> fue desbaneado de **${guild.name}**.`,
        embeds: [],
        components: [],
      });
    } else {
      database.updateAppealStatus(appealId, "processing", "rejected");
      const appellant = await client.users.fetch(appeal.userId);
      await sendUserNotice(
        appellant,
        makeEmbed("Apelación rechazada", `El dueño de **${guild.name}** revisó tu solicitud y decidió mantener el ban.`, 0xffc4d6),
      );
      await interaction.update({
        content: `Apelación rechazada. El ban de <@${appeal.userId}> sigue activo en **${guild.name}**.`,
        embeds: [],
        components: [],
      });
    }
  } catch (error) {
    database.updateAppealStatus(appealId, "processing", "appealed");
    throw error;
  }
}

async function resolveTarget(message, token) {
  const idMatch = /^(?:<@!?(\d+)>|(\d{17,20}))$/.exec(token || "");
  if (!idMatch) {
    return null;
  }

  const userId = idMatch[1] || idMatch[2];
  const mentionedUser = message.mentions.users.get(userId);
  if (mentionedUser) {
    return mentionedUser;
  }

  try {
    return await client.users.fetch(userId);
  } catch (error) {
    if (error.code === 10013) {
      return null;
    }
    throw error;
  }
}

function isImage(attachment) {
  if (attachment.contentType?.toLowerCase().startsWith("image/")) {
    return true;
  }
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(attachment.name);
}

function durationLabel(seconds) {
  const units = [
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
    ["s", 1],
  ];
  for (const [label, value] of units) {
    if (seconds % value === 0) {
      return `${seconds / value}${label}`;
    }
  }
  return `${seconds}s`;
}

async function handleBan(message, args) {
  const user = await resolveTarget(message, args.shift());
  if (!user) {
    await replyEmbed(message, makeEmbed(`${customEmojis.ban} Cómo usar ban`, "`!ban @usuario [tiempo] [razón]`\nEjemplo: `!ban @usuario 2h Spam`", 0xffc4d6));
    return;
  }
  if (user.id === message.author.id) {
    await replyEmbed(message, makeEmbed(`${customEmojis.error} No se pudo completar`, "No puedes banearte a ti mismo.", 0xffc4d6));
    return;
  }

  let durationSeconds = null;
  const possibleDuration = args[0];
  if (possibleDuration && /^\d/.test(possibleDuration)) {
    try {
      durationSeconds = parseDuration(possibleDuration);
      args.shift();
    } catch (error) {
      await replyEmbed(message, makeEmbed(`${customEmojis.error} Duración no válida`, error.message, 0xffc4d6));
      return;
    }
  }

  const reason = args.join(" ").trim() || "Sin motivo indicado.";
  await message.guild.members.ban(user.id, { reason });

  if (durationSeconds === null) {
    database.removeScheduledBan(message.guildId, user.id);
    const notice = makeEmbed(`${customEmojis.ban} Has sido baneado`, `**Servidor:** ${message.guild.name}\n**Duración:** Permanente\n**Razón:** ${reason}`, 0xffc4d6);
    const dmSent = await sendUserNotice(user, notice);
    await replyEmbed(
      message,
      addNoticeResult(
        makeEmbed(`${customEmojis.ban} Baneo permanente`, `**Usuario:** ${user}\n**Razón:** ${reason}`, 0xffc4d6)
          .setThumbnail(user.displayAvatarURL()),
        dmSent,
      ),
    );
    return;
  }

  const expiresAt = Date.now() + durationSeconds * 1000;
  database.scheduleBan({
    guildId: message.guildId,
    userId: user.id,
    moderatorId: message.author.id,
    reason,
    expiresAt,
  });
  const expiryTimestamp = Math.floor(expiresAt / 1000);
  const dmSent = await sendUserNotice(
    user,
    makeEmbed(
      `${customEmojis.clock} Has sido baneado temporalmente`,
      `**Servidor:** ${message.guild.name}\n**Duración:** ${durationLabel(durationSeconds)}\n**Finaliza:** <t:${expiryTimestamp}:F>\n**Razón:** ${reason}`,
      0xffc4d6,
    ),
  );
  await replyEmbed(
    message,
    addNoticeResult(
      makeEmbed(
        `${customEmojis.clock} Baneo temporal`,
        `**Usuario:** ${user}\n**Duración:** ${durationLabel(durationSeconds)}\n**Finaliza:** <t:${expiryTimestamp}:R>\n**Razón:** ${reason}`,
        0xffc4d6,
      ).setThumbnail(user.displayAvatarURL()),
      dmSent,
    ),
  );
}

async function handleWarn(message, args) {
  const user = await resolveTarget(message, args.shift());
  const reason = args.join(" ").trim();
  const image = message.attachments.find((attachment) => isImage(attachment));
  if (!user || !reason) {
    await replyEmbed(
      message,
      makeEmbed(`${customEmojis.warning} Cómo usar warn`, "`!warn @usuario razón`\nEjemplo: `!warn @usuario Spam repetido`", 0xffe7a8),
    );
    return;
  }
  if (message.attachments.size > 0 && !image) {
    await replyEmbed(message, makeEmbed(`${customEmojis.error} Imagen no válida`, "El archivo adjunto debe ser una imagen.", 0xffc4d6));
    return;
  }

  const warningCreatedAt = Date.now();
  database.addWarning({
    guildId: message.guildId,
    userId: user.id,
    moderatorId: message.author.id,
    reason,
    createdAt: warningCreatedAt,
  });

  const warningCount = database.getWarningCount(message.guildId, user.id);
  if (warningCount >= 6) {
    await message.guild.members.ban(user.id, {
      reason: `Baneo automático: ${warningCount} advertencias. Última razón: ${reason}`.slice(0, 512),
    });
    const appealId = database.createAppeal({
      guildId: message.guildId,
      userId: user.id,
      createdAt: warningCreatedAt,
    });
    const banNotice = makeEmbed(
      `${customEmojis.ban} Ban permanente por advertencias`,
      `**Servidor:** ${message.guild.name}\n**Motivo:** alcanzaste ${warningCount} advertencias.\n**Última advertencia:** ${reason}\n\nPuedes apelar con el botón para pedir al dueño del servidor que revise el caso.`,
      0xffc4d6,
    );
    if (image) {
      banNotice.setImage(image.url);
    }
    const dmSent = await sendUserNotice(user, banNotice, appealButtons(appealId));
    const confirmation = makeEmbed(
      `${customEmojis.ban} Ban permanente automático`,
      `**Usuario:** ${user}\n**Advertencias:** ${warningCount}\n**Última razón:** ${reason}\nEl usuario puede apelar por mensaje privado.`,
      0xffc4d6,
    ).setThumbnail(user.displayAvatarURL());
    if (image) {
      confirmation.setImage(image.url);
    }
    await replyEmbed(message, addNoticeResult(confirmation, dmSent));
    return;
  }

  const notice = makeEmbed(
    `${customEmojis.warning} Has recibido una advertencia`,
    `**Servidor:** ${message.guild.name}\n**Razón:** ${reason}`,
    0xffe7a8,
  );
  if (image) {
    notice.setImage(image.url);
  }
  const dmSent = await sendUserNotice(user, notice);
  const confirmation = makeEmbed(
    `${customEmojis.warning} Advertencia registrada`,
    `**Usuario:** ${user}\n**Razón:** ${reason}`,
    0xffe7a8,
  ).setThumbnail(user.displayAvatarURL());
  if (image) {
    confirmation.setImage(image.url);
  }
  await replyEmbed(
    message,
    addNoticeResult(confirmation, dmSent),
  );
}

async function handleRemoveWarns(message, args) {
  const user = await resolveTarget(message, args.shift());
  const amount = Number(args[0]);
  if (!user || !Number.isInteger(amount) || amount < 1 || amount > 50) {
    await replyEmbed(
      message,
      makeEmbed(
        `${customEmojis.error} Cómo usar removewarns`,
        "`!removewarns @usuario cantidad`\nPuedes quitar entre 1 y 50 advertencias recientes.",
        0xffc4d6,
      ),
    );
    return;
  }

  const removed = database.removeRecentWarnings(message.guildId, user.id, amount);
  const remaining = database.getWarningCount(message.guildId, user.id);
  await replyEmbed(
    message,
    makeEmbed(
      `${customEmojis.success} Advertencias actualizadas`,
      `Se quitaron **${removed}** advertencias recientes de ${user}.\nAhora tiene **${remaining}**.`,
      0xc8f7dc,
    ),
  );
}

async function handleUnban(message, args) {
  const user = await resolveTarget(message, args.shift());
  if (!user) {
    await replyEmbed(
      message,
      makeEmbed(`${customEmojis.error} Cómo usar unban`, "`!unban @usuario [razón]`", 0xffc4d6),
    );
    return;
  }

  const reason = args.join(" ").trim() || `Desbaneado por ${message.author.tag}.`;
  await message.guild.members.unban(user.id, reason);
  database.removeScheduledBan(message.guildId, user.id);
  await replyEmbed(
    message,
    makeEmbed(
      `${customEmojis.success} Ban quitado`,
      `Se quitó el ban de ${user}.\n**Razón:** ${reason}`,
      0xc8f7dc,
    ),
  );
}

async function handleWarnSee(message, args) {
  const user = await resolveTarget(message, args.shift());
  if (!user) {
    await replyEmbed(
      message,
      makeEmbed(`${customEmojis.error} Cómo usar warnsee`, "`!warnsee @usuario`", 0xffc4d6),
    );
    return;
  }

  const count = database.getWarningCount(message.guildId, user.id);
  const warnings = database.getRecentWarnings(message.guildId, user.id);
  const embed = new EmbedBuilder()
    .setColor(0xffe7a8)
    .setAuthor({ name: `Warns del usuario "${user.username}" ${customEmojis.shield}` });
  embed.setThumbnail(user.displayAvatarURL());

  if (warnings.length === 0) {
    embed.setDescription("No tiene advertencias registradas.");
  } else {
    const chronologicalWarnings = warnings.reverse();
    const firstWarningNumber = count - chronologicalWarnings.length + 1;
    const warningLines = chronologicalWarnings.map(
      (warning, index) =>
        `- Warn ${firstWarningNumber + index} : "${warning.reason.slice(0, 350)}"`,
    );
    if (count > warnings.length) {
      warningLines.unshift(`Mostrando las ${warnings.length} advertencias más recientes de ${count}.\n`);
    }
    embed.setDescription(warningLines.join("\n"));
  }

  await replyEmbed(message, embed);
}

async function handleSeeNotes(message, args) {
  const user = await resolveTarget(message, args.shift());
  if (!user) {
    await replyEmbed(
      message,
      makeEmbed(`${customEmojis.error} Cómo usar seenotes`, "`!seenotes @usuario`", 0xffc4d6),
    );
    return;
  }

  const notes = database.getRecentNotes(message.guildId, user.id);
  const embed = new EmbedBuilder()
    .setColor(0xd9c2ff)
    .setAuthor({ name: `Notas de "${user.username}" ${customEmojis.note}` })
    .setThumbnail(user.displayAvatarURL());

  if (notes.length === 0) {
    embed.setDescription("No hay notas guardadas para este usuario.");
  } else {
    embed.setDescription(
      notes
        .map((note, index) => {
          const content = note.note.length > 700 ? `${note.note.slice(0, 697)}...` : note.note;
          return `**${notes.length - index}.** ${content}\n` +
            `*Por <@${note.moderatorId}> · <t:${Math.floor(note.createdAt / 1000)}:R>*` +
            (note.imageUrl ? `\n[Ver imagen](${note.imageUrl})` : "");
        })
        .join("\n\n")
        .slice(0, 4000),
    );
  }

  await replyEmbed(message, embed);
}

async function handleCreateNote(message, args) {
  const user = await resolveTarget(message, args.shift());
  const note = args.join(" ").trim();
  const image = message.attachments.find((attachment) => isImage(attachment));

  if (!user || !note) {
    await replyEmbed(
      message,
      makeEmbed(
        `${customEmojis.note} Cómo usar createnote`,
        "`!createnote @usuario nota` y adjunta una imagen opcional.\nEjemplo: `!createnote @usuario Revisar el caso`",
        0xffc4d6,
      ),
    );
    return;
  }
  if (message.attachments.size > 0 && !image) {
    await replyEmbed(message, makeEmbed(`${customEmojis.error} Archivo no válido`, "El archivo adjunto debe ser una imagen.", 0xffc4d6));
    return;
  }

  database.addNote({
    guildId: message.guildId,
    userId: user.id,
    moderatorId: message.author.id,
    note,
    imageUrl: image?.url || null,
    createdAt: Date.now(),
  });

  const embed = makeEmbed(`${customEmojis.note} Nota guardada`, `**Para:** ${user}\n\n${note}`, 0xc8f7dc)
    .setThumbnail(user.displayAvatarURL());
  if (image) {
    embed.setImage(image.url);
  }
  const dmNotice = makeEmbed(
    `${customEmojis.note} Nota de moderación`,
    `**Servidor:** ${message.guild.name}\n\n${note}`,
    0xd9c2ff,
  );
  if (image) {
    dmNotice.setImage(image.url);
  }
  const dmSent = await sendUserNotice(user, dmNotice);
  await replyEmbed(message, addNoticeResult(embed, dmSent));
}

async function handleHelp(message) {
  const prefix = database.getPrefix(message.guildId);
  const embed = new EmbedBuilder()
    .setColor(0xe6d9ff)
    .setAuthor({ name: "RalBot · Guía de comandos", iconURL: message.client.user.displayAvatarURL() })
    .setDescription(`${customEmojis.moderation} Moderación sencilla y ordenada ${customEmojis.moderation}`)
    .addFields(
      { name: `${customEmojis.ban} Baneo`, value: `\`${prefix}ban @usuario [tiempo] [razón]\` · También \`/ban\``, inline: false },
      { name: `${customEmojis.warning} Advertencias`, value: `\`${prefix}warn @usuario razón\` · \`/warn\`\n\`${prefix}warnsee @usuario\` · \`/warnsee\`\n\`${prefix}removewarns @usuario cantidad\` · \`/removewarns\``, inline: false },
      { name: `${customEmojis.note} Notas`, value: `\`${prefix}createnote @usuario nota\` · \`/createnote\`\n\`${prefix}seenotes @usuario\` · \`/seenotes\``, inline: false },
      { name: `${customEmojis.success} Moderación y ayuda`, value: `\`${prefix}unban @usuario [razón]\` · \`/unban\`\n\`${prefix}modifyprefix %\` · \`/modifyprefix\`\n\`${prefix}help\` · \`/help\``, inline: false },
    )
    .addFields({
      name: "Auto-moderación",
      value: "Al llegar a 6 advertencias, el bot aplica un ban permanente. El usuario puede apelar por DM; el dueño del servidor decide si lo levanta.",
    })
    .setFooter({ text: "RalBot ✦ Los comandos slash también aparecen al escribir /" });
  await replyEmbed(message, embed);
}

async function handleModifyPrefix(message, rawPrefix) {
  if (!isValidPrefix(rawPrefix)) {
    await replyEmbed(
      message,
      makeEmbed(
        `${customEmojis.error} Prefijo no válido`,
        "El prefijo debe ser un solo símbolo (por ejemplo `!`, `%` o `?`).",
        0xffc4d6,
      ),
    );
    return;
  }

  database.setPrefix(message.guildId, rawPrefix);
  await replyEmbed(
    message,
    makeEmbed(
      `${customEmojis.success} Prefijo actualizado`,
      `El nuevo prefijo de este servidor es \`${rawPrefix}\`. Prueba \`${rawPrefix}help\`.`,
      0xc8f7dc,
    ),
  );
}

async function handleMessage(message) {
  if (message.author.bot || !message.guild) {
    return;
  }
  const prefix = database.getPrefix(message.guildId);
  if (!message.content.startsWith(prefix)) {
    return;
  }

  const [command, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
  if (!command) {
    return;
  }
  const normalizedCommand = command.toLowerCase();

  try {
    if (normalizedCommand === "help") {
      await handleHelp(message);
      return;
    }
    if (normalizedCommand === "modifyprefix") {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await replyEmbed(message, makeEmbed(`${customEmojis.error} Sin permiso`, "Necesitas el permiso Administrar servidor para cambiar el prefijo.", 0xffc4d6));
        return;
      }
      await handleModifyPrefix(message, args[0]);
      return;
    }
    if (normalizedCommand === "unban") {
      if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        await replyEmbed(message, makeEmbed(`${customEmojis.error} Sin permiso`, "Necesitas el permiso Ban Members para quitar bans.", 0xffc4d6));
        return;
      }
      await handleUnban(message, args);
      return;
    }

    const requiredPermission =
      normalizedCommand === "ban"
        ? PermissionFlagsBits.BanMembers
        : PermissionFlagsBits.ModerateMembers;
    if (!["ban", "warn", "warnsee", "removewarns", "seenotes", "createnote"].includes(normalizedCommand)) {
      return;
    }
    if (!message.member.permissions.has(requiredPermission)) {
      await replyEmbed(
        message,
        makeEmbed(`${customEmojis.error} Sin permiso`, "No tienes permiso para usar este comando.", 0xffc4d6),
      );
      return;
    }

    switch (normalizedCommand) {
      case "ban":
        await handleBan(message, args);
        break;
      case "warn":
        await handleWarn(message, args);
        break;
      case "warnsee":
        await handleWarnSee(message, args);
        break;
      case "removewarns":
        await handleRemoveWarns(message, args);
        break;
      case "seenotes":
        await handleSeeNotes(message, args);
        break;
      case "createnote":
        await handleCreateNote(message, args);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error(`Error ejecutando ${prefix}${normalizedCommand}:`, error);
    const description =
      normalizedCommand === "ban"
        ? "No se pudo completar el baneo. Revisa los permisos y la jerarquía de roles del bot."
        : "No se pudo completar el comando. Revisa los registros del bot.";
    await replyEmbed(
      message,
      makeEmbed(`${customEmojis.error} Ocurrió un error`, description, 0xffc4d6),
    );
  }
}

function makeInteractionMessage(interaction) {
  const user = interaction.options.getUser("usuario");
  const image = interaction.options.getAttachment("imagen");
  const attachmentList = image ? [image] : [];

  return {
    author: interaction.user,
    client,
    guild: interaction.guild,
    guildId: interaction.guildId,
    member: interaction.member,
    createdAt: interaction.createdAt,
    channel: interaction.channel,
    content: "",
    attachments: Object.assign(attachmentList, {
      find: Array.prototype.find.bind(attachmentList),
      size: attachmentList.length,
    }),
    mentions: {
      users: {
        get: (id) => (user?.id === id ? user : undefined),
      },
    },
    reply: ({ embeds }) => interaction.editReply({ embeds }),
  };
}

async function handleSlashCommand(interaction) {
  if (!interaction.isChatInputCommand()) {
    return;
  }
  if (!interaction.inGuild()) {
    await interaction.reply({
      embeds: [makeEmbed(`${customEmojis.error} Comando de servidor`, "Este comando solo funciona dentro de un servidor.", 0xffc4d6)],
      ephemeral: true,
    });
    return;
  }

  const name = interaction.commandName;
  const requiredPermission =
    name === "ban" || name === "unban"
      ? PermissionFlagsBits.BanMembers
      : name === "modifyprefix"
        ? PermissionFlagsBits.ManageGuild
        : PermissionFlagsBits.ModerateMembers;
  if (!["help", "ban", "warn", "warnsee", "removewarns", "seenotes", "createnote", "unban", "modifyprefix"].includes(name)) {
    return;
  }
  if (name !== "help" && !interaction.memberPermissions?.has(requiredPermission)) {
    await interaction.reply({
      embeds: [makeEmbed(`${customEmojis.error} Sin permiso`, "No tienes permiso para usar este comando.", 0xffc4d6)],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const message = makeInteractionMessage(interaction);
  const user = interaction.options.getUser("usuario");
  const args = [];
  if (user) {
    args.push(`<@${user.id}>`);
  }

  switch (name) {
    case "help":
      await handleHelp(message);
      return;
    case "modifyprefix":
      await handleModifyPrefix(message, interaction.options.getString("prefijo", true));
      return;
    case "ban": {
      const duration = interaction.options.getString("tiempo");
      const reason = interaction.options.getString("razon");
      if (duration) args.push(duration);
      if (reason) args.push(reason);
      await handleBan(message, args);
      return;
    }
    case "warn":
      args.push(interaction.options.getString("razon", true));
      await handleWarn(message, args);
      return;
    case "warnsee":
      await handleWarnSee(message, args);
      return;
    case "removewarns":
      args.push(String(interaction.options.getInteger("cantidad", true)));
      await handleRemoveWarns(message, args);
      return;
    case "seenotes":
      await handleSeeNotes(message, args);
      return;
    case "createnote":
      args.push(interaction.options.getString("nota", true));
      await handleCreateNote(message, args);
      return;
    case "unban": {
      const reason = interaction.options.getString("razon");
      if (reason) args.push(reason);
      await handleUnban(message, args);
      return;
    }
    default:
      return;
  }
}

async function releaseExpiredBans() {
  if (checkingExpiredBans) {
    return;
  }
  checkingExpiredBans = true;

  try {
    const expiredBans = database.getExpiredBans(Date.now());
    for (const ban of expiredBans) {
      const guild = await client.guilds.fetch(ban.guildId);
      try {
        await guild.members.unban(ban.userId, "Fin del baneo temporal.");
      } catch (error) {
        if (error.code !== 10026) {
          throw error;
        }
      }
      database.removeScheduledBan(ban.guildId, ban.userId);
    }
  } catch (error) {
    console.error("Error procesando baneos temporales vencidos:", error);
  } finally {
    checkingExpiredBans = false;
  }
}

async function start() {
  const { DISCORD_TOKEN } = process.env;
  if (!DISCORD_TOKEN) {
    throw new Error("Configura DISCORD_TOKEN en las variables de entorno.");
  }
  await client.login(DISCORD_TOKEN);
}

async function registerCommandsForGuild(rest, applicationId, guildId) {
  await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
    body: guildSlashCommands,
  });
  console.log(`Comandos slash registrados en el servidor ${guildId}.`);
}

client.on(Events.MessageCreate, (message) => {
  void handleMessage(message);
});

client.on(Events.GuildCreate, (guild) => {
  if (!client.isReady()) {
    return;
  }
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  void registerCommandsForGuild(rest, client.application.id, guild.id).catch((error) => {
    console.error(`No se pudieron registrar comandos slash en el servidor ${guild.id}:`, error);
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  const handler = interaction.isButton()
    ? handleButtonInteraction(interaction)
    : handleSlashCommand(interaction);
  void handler.catch(async (error) => {
    const interactionLabel = interaction.isButton()
      ? interaction.customId
      : `/${interaction.commandName}`;
    console.error(`Error ejecutando ${interactionLabel}:`, error);
    const details =
      typeof error?.message === "string"
        ? `\n\nDetalle: \`${error.message.slice(0, 300)}\``
        : "";
    const response = {
      embeds: [
        makeEmbed(
          `${customEmojis.error} Ocurrió un error`,
          `No se pudo completar el comando.${details}`,
          0xffc4d6,
        ),
      ],
    };
    if (interaction.deferred) {
      await interaction.editReply(response);
    } else if (interaction.replied) {
      await interaction.followUp({ ...response, ephemeral: true });
    } else {
      await interaction.reply({ ...response, ephemeral: true });
    }
  });
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Conectado como ${readyClient.user.tag}. Usa !help o /help en un servidor.`);
  for (const name of Object.keys(EMOJI_CONFIG)) {
    const markup = resolveEmoji(readyClient, name);
    if (markup.startsWith("<a:")) {
      console.log(`Emoji animado disponible: ${name} (${EMOJI_CONFIG[name].id}).`);
    }
  }
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(readyClient.application.id), { body: [] });
    console.log("Se limpiaron los comandos slash globales duplicados.");
  } catch (error) {
    console.error("No se pudieron registrar los comandos slash globales:", error);
  }
  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await registerCommandsForGuild(rest, readyClient.application.id, guild.id);
    } catch (error) {
      console.error(`No se pudieron registrar comandos slash en el servidor ${guild.id}:`, error);
    }
  }
  void releaseExpiredBans();
  setInterval(() => void releaseExpiredBans(), 15_000);
});

start().catch((error) => {
  console.error("No se pudo iniciar el bot:", error);
  process.exitCode = 1;
});
