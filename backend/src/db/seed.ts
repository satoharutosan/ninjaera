import bcrypt from "bcryptjs";
import crypto from "crypto";
import { qGet, qRun } from "./query.js";
import { resolveSuperAdminEmail } from "../services/adminPermissions.js";

const now = () => new Date().toISOString();

const isProd = () => (process.env.NODE_ENV || "").toLowerCase() === "production";

async function insertAdminUser(opts: {
  email: string;
  username: string;
  passwordHash: string;
  ts: string;
}): Promise<number> {
  const demoId = (await qRun(`
    INSERT INTO users (
      email, username, password_hash, gender, status, bio, member_since,
      level, rank, is_npc, is_admin, email_verified, email_verified_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?, ?)
  `,
    opts.email,
    opts.username,
    opts.passwordHash,
    "Prefer not to say",
    "Online",
    "",
    opts.ts.slice(0, 10),
    1,
    "Admin",
    opts.ts,
    opts.ts,
    opts.ts,
  )).lastInsertRowid as number;

  await qRun(
    `INSERT INTO user_settings (user_id, email_notif, push_notif, two_fa, public_profile) VALUES (?, 1, 0, 0, 1)`,
    demoId,
  );
  await qRun(`
    INSERT INTO game_stats (user_id, missions_complete, pvp_wins, playtime_hours, legendary_items, ninjutsu, taijutsu, genjutsu, senjutsu, kenjutsu)
    VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  `, demoId);
  return demoId;
}

/**
 * Ensure the Super Admin account exists after migrations.
 * Runs on every boot (not only empty DBs) so Railway Postgres deploys get an
 * admin even when seed was skipped or users already exist without the SA email.
 *
 * Password precedence:
 *   1. SEED_ADMIN_PASSWORD (required in production unless account already exists)
 *   2. Dev-only fallback for local empty DBs
 */
export async function ensureSuperAdmin(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL || resolveSuperAdminEmail()).trim().toLowerCase();
  const username = (process.env.SEED_ADMIN_USERNAME || "admin").trim() || "admin";

  const existing = await qGet<{ id: number; is_admin: number; is_disabled: number | null; is_deleted: number | null }>(
    "SELECT id, is_admin, is_disabled, is_deleted FROM users WHERE LOWER(email) = ? AND is_npc = 0 LIMIT 1",
    email,
  );

  if (existing) {
    // Keep Super Admin flags healthy if the row already exists.
    if (existing.is_admin !== 1 || existing.is_disabled === 1 || existing.is_deleted === 1) {
      await qRun(
        `UPDATE users SET is_admin = 1, is_disabled = 0, is_deleted = 0, email_verified = 1, updated_at = ? WHERE id = ?`,
        now(),
        existing.id,
      );
      console.log(`[seed] Super Admin restored/enabled: ${email}`);
    }
    return;
  }

  let password = process.env.SEED_ADMIN_PASSWORD || "";
  let generated = false;
  if (!password) {
    if (isProd()) {
      password = crypto.randomBytes(18).toString("base64url");
      generated = true;
    } else {
      password = "123231323123q";
    }
  }

  if (isProd() && password.length < 12 && !generated) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters in production");
  }

  const ts = now();
  const passwordHash = bcrypt.hashSync(password, isProd() ? 12 : 10);
  await insertAdminUser({ email, username, passwordHash, ts });

  if (generated) {
    console.warn("[seed] ==========================================================");
    console.warn(`[seed] Super Admin created: ${email}`);
    console.warn(`[seed] One-time password:   ${password}`);
    console.warn("[seed] Change this password immediately after first login.");
    console.warn("[seed] Set SEED_ADMIN_PASSWORD in Railway to control the password.");
    console.warn("[seed] ==========================================================");
  } else {
    console.log(`[seed] Super Admin bootstrapped: ${email}`);
  }
}

/**
 * Seed empty databases.
 * Production: only create an admin when SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD are set
 * (never a hardcoded password). Development: keep the demo dataset for local UX.
 * Super Admin is always ensured separately via ensureSuperAdmin().
 */
export async function seedDatabase() {
  const userCount = await qGet<{ c: number }>("SELECT COUNT(*) as c FROM users");
  if (userCount!.c > 0) {
    await ensureSuperAdmin();
    return;
  }

  if (isProd()) {
    // Production empty DB: ensureSuperAdmin handles the SA account.
    await ensureSuperAdmin();
    return;
  }

  const passwordHash = bcrypt.hashSync("123231323123q", 10);
  const ts = now();

  const insertUserSql = `
    INSERT INTO users (email, username, password_hash, gender, country, city, status, bio, member_since, village, clan, level, rank, is_npc, is_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const demoId = (await qRun(
    insertUserSql,
    "admin@ninjaera.com", "ninjaera", passwordHash,
    "Prefer not to say", "Japan", "Osaka", "Online",
    "",
    "2024-03-15", "Leaf Village", "Dragon Clan", 47, "Jonin", 0, 1, ts, ts
  )).lastInsertRowid as number;

  await qRun(`
  INSERT INTO user_settings (user_id, email_notif, push_notif, two_fa, public_profile)
  VALUES (?, 1, 0, 0, 1)
  `, demoId);

  await qRun(`
  INSERT INTO game_stats (user_id, missions_complete, pvp_wins, playtime_hours, legendary_items, ninjutsu, taijutsu, genjutsu, senjutsu, kenjutsu)
  VALUES (?, 142, 89, 312, 7, 85, 72, 68, 45, 90)
  `, demoId);

  const achievements = [
    ["First Blood", "Won your first PvP match", "military"],
    ["Raid Master", "Completed 50 guild raids", "emoji_events"],
    ["Legendary Hunter", "Collected 5 legendary items", "diamond"],
    ["Shadow Walker", "Completed the Shadow Realm questline", "shield"],
  ];
  const insertAchSql = "INSERT INTO achievements (user_id, title, description, icon, earned_at) VALUES (?, ?, ?, ?, ?)";
  for (const [title, desc, icon] of achievements) {
    await qRun(insertAchSql, demoId, title, desc, icon, ts);
  }

  const inventory = [
    ["Void Blade", "legendary", 1, "diamond"],
    ["Ember Cloak", "epic", 1, "whatshot"],
    ["Health Potion", "common", 24, "star"],
    ["Kunai Pack", "uncommon", 50, "shield"],
  ];
  const insertInvSql = "INSERT INTO inventory_items (user_id, name, rarity, quantity, icon) VALUES (?, ?, ?, ?, ?)";
  for (const [name, rarity, qty, icon] of inventory) {
    await qRun(insertInvSql, demoId, name, rarity, qty, icon);
  }

  const activities = [
    "Completed mission: Shadow Fortress Assault",
    "Won PvP match against Koga Shadowstep",
    "Crafted Ember Cloak at the forge",
    "Joined guild raid: Dragon Sanctum",
  ];
  const insertActSql = "INSERT INTO activity_log (user_id, description, created_at) VALUES (?, ?, ?)";
  for (const desc of activities) {
    await qRun(insertActSql, demoId, desc, ts);
  }

  const npcs = [
    ["ryuu@npc.local", "Ryuu Ashikaga", "Online", "Guild leader of Dragon Sanctum Raiders. Expert in fire-style jutsu and tactical coordination.", "Fire Village", "Dragon Clan", 52],
    ["sakura@npc.local", "Sakura Tenma", "Online", "Support specialist from Cherry Blossom Village. Healer and enchantment master.", "Cherry Blossom Village", "Healing Clan", 44],
    ["koga@npc.local", "Koga Shadowstep", "Offline", "Shadow assassin from the Mist. Prefers working alone but fights fiercely for the guild.", "Mist Village", "Shadow Clan", 48],
    ["miyuki@npc.local", "Miyuki Frost", "Online", "Ice-elemental mage. Known for crafting rare gear and sharing knowledge.", "Snow Village", "Frost Clan", 41],
    ["hanzo@npc.local", "Hanzo Yamakage", "Offline", "Veteran player. Tracks every patch note and meta shift.", "Stone Village", "Veteran Clan", 55],
  ];
  const npcIds: number[] = [];
  for (const [email, username, status, bio, village, clan, level] of npcs) {
    const id = (await qRun(
      insertUserSql,
      email, username, passwordHash, "Prefer not to say", "Japan", null, status, bio,
      ts.slice(0, 10), village, clan, level, "Chunin", 1, 0, ts, ts
    )).lastInsertRowid as number;
    npcIds.push(id);
  }

  const notifs = [
    ["Maintenance Window", "Scheduled maintenance on July 12 from 2AM–4AM UTC. Log off to avoid interruption."],
    ["New Season Launch", "Season 4 — Shadow Realm begins July 15. New raids, weapons, and clan rankings."],
    ["Guild War Results", "Dragon Sanctum Raiders claimed first place in last week's territory war."],
  ];
  const insertNotifSql = "INSERT INTO notifications (title, body, source, page, created_at) VALUES (?, ?, 'Operations', 'alarms', ?)";
  const notifIds: number[] = [];
  for (const [title, body] of notifs) {
    const id = (await qRun(insertNotifSql, title, body, ts)).lastInsertRowid as number;
    notifIds.push(id);
  }
  await qRun("INSERT INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)", demoId, notifIds[2], ts);

  const insertConvSql = "INSERT INTO conversations (type, name, bio, created_at) VALUES (?, ?, ?, ?)";
  const insertPartSql = "INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)";

  const channels = [
    ["channel", "# general", "Main guild text channel for general discussion and announcements."],
    ["channel", "# raid-planning", "Coordinate raid strategies, schedules, and team compositions here."],
    ["channel", "# trading-post", "Player-to-player item trading. Post your buy/sell listings here."],
  ];
  const channelIds: number[] = [];
  for (const [type, name, bio] of channels) {
    const id = (await qRun(insertConvSql, type, name, bio, ts)).lastInsertRowid as number;
    channelIds.push(id);
    await qRun(insertPartSql, id, demoId, ts);
  }

  const dmConvs = [
    [npcIds[0], "Ryuu Ashikaga"],
    [npcIds[1], "Sakura Tenma"],
    [npcIds[2], "Koga Shadowstep"],
    [npcIds[3], "Miyuki Frost"],
    [npcIds[4], "Hanzo Yamakage"],
  ];
  const dmIds: number[] = [];
  for (const [npcId, name] of dmConvs) {
    const convId = (await qRun(insertConvSql, "dm", name, "", ts)).lastInsertRowid as number;
    dmIds.push(convId);
    await qRun(insertPartSql, convId, demoId, ts);
    await qRun(insertPartSql, convId, npcId, ts);
  }

  const insertMsgSql = `
    INSERT INTO messages (conversation_id, user_id, content, created_at)
    VALUES (?, ?, ?, ?)
  `;

  const ryuuMsgs = [
    [npcIds[0], "Hey! Are you free tonight for the Dragon Sanctum raid?"],
    [demoId, "Yeah I'm in! What time are we starting?"],
    [npcIds[0], "9PM server time. Kazuki and Sakura are already confirmed."],
    [demoId, "Perfect. I'll make sure my gear is repaired and stocked."],
    [npcIds[0], "Bring fire resist gear — the boss has a nasty AoE flame phase."],
    [demoId, "Got it, I have the Ember Cloak set ready!"],
  ];
  for (const [userId, content] of ryuuMsgs) {
    await qRun(insertMsgSql, dmIds[0], userId, content, ts);
  }

  await qRun(insertMsgSql, channelIds[0], npcIds[0], "Welcome to the guild channel!", ts);
  await qRun(insertMsgSql, channelIds[1], npcIds[1], "Boss strategy posted above", ts);
  await qRun(insertMsgSql, channelIds[2], npcIds[2], "WTB Void Blade — paying well", ts);
  await qRun(insertMsgSql, dmIds[1], npcIds[1], "I got the Legendary drop!", ts);
  await qRun(insertMsgSql, dmIds[2], npcIds[2], "Guild war starts in 2 hours", ts);
  await qRun(insertMsgSql, dmIds[3], npcIds[3], "Can you help me craft this?", ts);
  await qRun(insertMsgSql, dmIds[4], npcIds[4], "Check the new patch notes", ts);

  const jobs = [
    ["Senior 3D Artist", "Art", "Remote · Full-time", "Create stunning 3D assets for the Ninja Era world."],
    ["Backend Engineer", "Engineering", "Remote · Full-time", "Build scalable server infrastructure for our MMORPG."],
    ["Game Developer", "Game", "Remote · Part-time", "Help shape the game experience across platforms."],
    ["Blockchain Developer", "Blockchain", "Remote · Full-time", "Develop in-game NFT and token systems."],
    ["AI/ML Engineer", "AI", "Remote · Full-time", "Create intelligent NPC behavior and procedural content."],
    ["UI/UX Designer", "Design", "Remote · Full-time", "Design intuitive interfaces for web and in-game HUD."],
  ];
  const insertJobSql = "INSERT INTO job_postings (title, department, employment_type, description) VALUES (?, ?, ?, ?)";
  for (const [title, dept, type, desc] of jobs) {
    await qRun(insertJobSql, title, dept, type, desc);
  }

  // Team members are created only when applications are approved — no placeholder roster.

  const resources = [
    ["Game Client Installer", "App", "PC and companion application installs for Ninja Era.", null],
    ["Getting Started Walkthrough", "Guide", "Step-by-step instructions for new shinobi.", null],
    ["UI Design Kit", "Design", "Layout references and creative design assets.", null],
    ["Character Concept Sheet", "Character Art", "Official character illustrations and concept art.", null],
    ["Sample Source Pack", "Source", "Development source files and project templates.", null],
  ];
  const insertResSql = "INSERT INTO resources (title, category, description, content_url, published_at) VALUES (?, ?, ?, ?, ?)";
  for (const [title, cat, desc, url] of resources) {
    await qRun(insertResSql, title, cat, desc, url, ts);
  }

  console.log("Database seeded successfully.");
  console.log("Admin account: admin@ninjaera.com");
  await ensureSuperAdmin();
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const { initSchema } = await import("./index.js");
  await initSchema();
  await seedDatabase();
}
