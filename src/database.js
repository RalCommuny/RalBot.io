const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { DEFAULT_PREFIX } = require("./prefix");

const databasePath = path.resolve(
  process.env.DATABASE_PATH || path.join(process.cwd(), "data", "ralbot.sqlite"),
);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS warnings_by_user
    ON warnings (guild_id, user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    note TEXT NOT NULL,
    image_url TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS notes_by_user
    ON notes (guild_id, user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS scheduled_bans (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS scheduled_bans_by_expiry
    ON scheduled_bans (expires_at);

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    prefix TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ban_appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting'
      CHECK (status IN ('waiting', 'notifying', 'appealed', 'processing', 'approved', 'rejected'))
  );

  CREATE INDEX IF NOT EXISTS pending_appeals_by_user
    ON ban_appeals (guild_id, user_id, status);
`);

const addWarning = db.prepare(`
  INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)
  VALUES (@guildId, @userId, @moderatorId, @reason, @createdAt)
`);

const getWarningCount = db.prepare(`
  SELECT COUNT(*) AS count FROM warnings WHERE guild_id = ? AND user_id = ?
`);

const getRecentWarnings = db.prepare(`
  SELECT id, moderator_id AS moderatorId, reason, created_at AS createdAt
  FROM warnings
  WHERE guild_id = ? AND user_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const addNote = db.prepare(`
  INSERT INTO notes (guild_id, user_id, moderator_id, note, image_url, created_at)
  VALUES (@guildId, @userId, @moderatorId, @note, @imageUrl, @createdAt)
`);

const getRecentNotes = db.prepare(`
  SELECT id, moderator_id AS moderatorId, note, image_url AS imageUrl,
         created_at AS createdAt
  FROM notes
  WHERE guild_id = ? AND user_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const scheduleBan = db.prepare(`
  INSERT INTO scheduled_bans (guild_id, user_id, moderator_id, reason, expires_at)
  VALUES (@guildId, @userId, @moderatorId, @reason, @expiresAt)
  ON CONFLICT (guild_id, user_id) DO UPDATE SET
    moderator_id = excluded.moderator_id,
    reason = excluded.reason,
    expires_at = excluded.expires_at
`);

const removeScheduledBan = db.prepare(`
  DELETE FROM scheduled_bans WHERE guild_id = ? AND user_id = ?
`);

const getExpiredBans = db.prepare(`
  SELECT guild_id AS guildId, user_id AS userId
  FROM scheduled_bans
  WHERE expires_at <= ?
  ORDER BY expires_at
  LIMIT 50
`);

const getPrefix = db.prepare(`
  SELECT prefix FROM guild_settings WHERE guild_id = ?
`);

const setPrefix = db.prepare(`
  INSERT INTO guild_settings (guild_id, prefix)
  VALUES (?, ?)
  ON CONFLICT (guild_id) DO UPDATE SET prefix = excluded.prefix
`);

const removeRecentWarnings = db.prepare(`
  DELETE FROM warnings
  WHERE id IN (
    SELECT id FROM warnings
    WHERE guild_id = ? AND user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  )
`);

const createAppeal = db.prepare(`
  INSERT INTO ban_appeals (guild_id, user_id, created_at, status)
  VALUES (@guildId, @userId, @createdAt, 'waiting')
`);

const getAppeal = db.prepare(`
  SELECT id, guild_id AS guildId, user_id AS userId,
         created_at AS createdAt, status
  FROM ban_appeals
  WHERE id = ?
`);

const updateAppealStatus = db.prepare(`
  UPDATE ban_appeals SET status = ?
  WHERE id = ? AND status = ?
`);

module.exports = {
  addNote: (note) => addNote.run(note),
  addWarning: (warning) => addWarning.run(warning),
  getExpiredBans: (now) => getExpiredBans.all(now),
  getRecentWarnings: (guildId, userId, limit = 10) =>
    getRecentWarnings.all(guildId, userId, limit),
  getPrefix: (guildId) => getPrefix.get(guildId)?.prefix || DEFAULT_PREFIX,
  getRecentNotes: (guildId, userId, limit = 10) =>
    getRecentNotes.all(guildId, userId, limit),
  getWarningCount: (guildId, userId) =>
    getWarningCount.get(guildId, userId).count,
  removeRecentWarnings: (guildId, userId, amount) =>
    removeRecentWarnings.run(guildId, userId, amount).changes,
  removeScheduledBan: (guildId, userId) =>
    removeScheduledBan.run(guildId, userId),
  createAppeal: (appeal) => Number(createAppeal.run(appeal).lastInsertRowid),
  getAppeal: (id) => getAppeal.get(id) || null,
  updateAppealStatus: (id, currentStatus, nextStatus) =>
    updateAppealStatus.run(nextStatus, id, currentStatus).changes === 1,
  scheduleBan: (ban) => scheduleBan.run(ban),
  setPrefix: (guildId, prefix) => setPrefix.run(guildId, prefix),
  close: () => db.close(),
};
