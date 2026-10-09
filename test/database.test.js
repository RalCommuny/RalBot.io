const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ralbot-moderation-test-"));
process.env.DATABASE_PATH = path.join(databaseDirectory, "test.sqlite");
const database = require("../src/database");

test.after(() => {
  database.close();
  fs.rmSync(databaseDirectory, { recursive: true, force: true });
});

test("removes the requested number of most recent warnings per server and user", () => {
  for (const [createdAt, reason] of [[1, "first"], [2, "second"], [3, "third"]]) {
    database.addWarning({
      guildId: "guild-a",
      userId: "user-a",
      moderatorId: "moderator",
      reason,
      createdAt,
    });
  }
  database.addWarning({
    guildId: "guild-b",
    userId: "user-a",
    moderatorId: "moderator",
    reason: "other server",
    createdAt: 4,
  });

  assert.equal(database.removeRecentWarnings("guild-a", "user-a", 2), 2);
  assert.equal(database.getWarningCount("guild-a", "user-a"), 1);
  assert.equal(database.getRecentWarnings("guild-a", "user-a")[0].reason, "first");
  assert.equal(database.getWarningCount("guild-b", "user-a"), 1);
});

test("stores appeals and allows status transitions only from expected state", () => {
  const appealId = database.createAppeal({
    guildId: "guild-a",
    userId: "user-b",
    createdAt: 10,
  });

  assert.equal(database.getAppeal(appealId).status, "waiting");
  assert.equal(database.updateAppealStatus(appealId, "waiting", "notifying"), true);
  assert.equal(database.updateAppealStatus(appealId, "waiting", "appealed"), false);
  assert.equal(database.updateAppealStatus(appealId, "notifying", "appealed"), true);
  assert.equal(database.getAppeal(appealId).status, "appealed");
});
