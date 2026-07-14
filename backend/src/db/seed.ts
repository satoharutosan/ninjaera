import bcrypt from "bcryptjs";
import { db } from "./index.js";

const now = () => new Date().toISOString();

export function seedDatabase() {
  const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  if (userCount.c > 0) return;

  const passwordHash = bcrypt.hashSync("password123", 10);
  const ts = now();

  const insertUser = db.prepare(`
    INSERT INTO users (email, username, password_hash, gender, country, city, status, bio, member_since, village, clan, level, rank, is_npc, is_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demoId = insertUser.run(
    "ninja@example.com", "ShadowNinja_X", passwordHash,
    "Prefer not to say", "Japan", "Tokyo", "Online",
    "A dedicated shinobi on the path to becoming Hokage.",
    "2024-03-15", "Leaf Village", "Dragon Clan", 47, "Jonin", 0, 1, ts, ts
  ).lastInsertRowid as number;

  db.prepare(`
  INSERT INTO user_settings (user_id, email_notif, push_notif, two_fa, public_profile)
  VALUES (?, 1, 0, 0, 1)
  `).run(demoId);

  db.prepare(`
  INSERT INTO game_stats (user_id, missions_complete, pvp_wins, playtime_hours, legendary_items, ninjutsu, taijutsu, genjutsu, senjutsu, kenjutsu)
  VALUES (?, 142, 89, 312, 7, 85, 72, 68, 45, 90)
  `).run(demoId);

  const achievements = [
    ["First Blood", "Won your first PvP match", "military"],
    ["Raid Master", "Completed 50 guild raids", "emoji_events"],
    ["Legendary Hunter", "Collected 5 legendary items", "diamond"],
    ["Shadow Walker", "Completed the Shadow Realm questline", "shield"],
  ];
  const insertAch = db.prepare("INSERT INTO achievements (user_id, title, description, icon, earned_at) VALUES (?, ?, ?, ?, ?)");
  for (const [title, desc, icon] of achievements) {
    insertAch.run(demoId, title, desc, icon, ts);
  }

  const inventory = [
    ["Void Blade", "legendary", 1, "diamond"],
    ["Ember Cloak", "epic", 1, "whatshot"],
    ["Health Potion", "common", 24, "star"],
    ["Kunai Pack", "uncommon", 50, "shield"],
  ];
  const insertInv = db.prepare("INSERT INTO inventory_items (user_id, name, rarity, quantity, icon) VALUES (?, ?, ?, ?, ?)");
  for (const [name, rarity, qty, icon] of inventory) {
    insertInv.run(demoId, name, rarity, qty, icon);
  }

  const activities = [
    "Completed mission: Shadow Fortress Assault",
    "Won PvP match against Koga Shadowstep",
    "Crafted Ember Cloak at the forge",
    "Joined guild raid: Dragon Sanctum",
  ];
  const insertAct = db.prepare("INSERT INTO activity_log (user_id, description, created_at) VALUES (?, ?, ?)");
  for (const desc of activities) {
    insertAct.run(demoId, desc, ts);
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
    const id = insertUser.run(
      email, username, passwordHash, "Prefer not to say", "Japan", null, status, bio,
      ts.slice(0, 10), village, clan, level, "Chunin", 1, 0, ts, ts
    ).lastInsertRowid as number;
    npcIds.push(id);
  }

  const notifs = [
    ["Maintenance Window", "Scheduled maintenance on July 12 from 2AM–4AM UTC. Log off to avoid interruption."],
    ["New Season Launch", "Season 4 — Shadow Realm begins July 15. New raids, weapons, and clan rankings."],
    ["Guild War Results", "Dragon Sanctum Raiders claimed first place in last week's territory war."],
  ];
  const insertNotif = db.prepare("INSERT INTO notifications (title, body, source, page, created_at) VALUES (?, ?, 'Operations', 'alarms', ?)");
  const notifIds: number[] = [];
  for (const [title, body] of notifs) {
    const id = insertNotif.run(title, body, ts).lastInsertRowid as number;
    notifIds.push(id);
  }
  db.prepare("INSERT INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)").run(demoId, notifIds[2], ts);

  const insertConv = db.prepare("INSERT INTO conversations (type, name, bio, created_at) VALUES (?, ?, ?, ?)");
  const insertPart = db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)");

  const channels = [
    ["channel", "# general", "Main guild text channel for general discussion and announcements."],
    ["channel", "# raid-planning", "Coordinate raid strategies, schedules, and team compositions here."],
    ["channel", "# trading-post", "Player-to-player item trading. Post your buy/sell listings here."],
  ];
  const channelIds: number[] = [];
  for (const [type, name, bio] of channels) {
    const id = insertConv.run(type, name, bio, ts).lastInsertRowid as number;
    channelIds.push(id);
    insertPart.run(id, demoId, ts);
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
    const convId = insertConv.run("dm", name, "", ts).lastInsertRowid as number;
    dmIds.push(convId);
    insertPart.run(convId, demoId, ts);
    insertPart.run(convId, npcId, ts);
  }

  const insertMsg = db.prepare(`
    INSERT INTO messages (conversation_id, user_id, content, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const ryuuMsgs = [
    [npcIds[0], "Hey! Are you free tonight for the Dragon Sanctum raid?"],
    [demoId, "Yeah I'm in! What time are we starting?"],
    [npcIds[0], "9PM server time. Kazuki and Sakura are already confirmed."],
    [demoId, "Perfect. I'll make sure my gear is repaired and stocked."],
    [npcIds[0], "Bring fire resist gear — the boss has a nasty AoE flame phase."],
    [demoId, "Got it, I have the Ember Cloak set ready!"],
  ];
  for (const [userId, content] of ryuuMsgs) {
    insertMsg.run(dmIds[0], userId, content, ts);
  }

  insertMsg.run(channelIds[0], npcIds[0], "Welcome to the guild channel!", ts);
  insertMsg.run(channelIds[1], npcIds[1], "Boss strategy posted above", ts);
  insertMsg.run(channelIds[2], npcIds[2], "WTB Void Blade — paying well", ts);
  insertMsg.run(dmIds[1], npcIds[1], "I got the Legendary drop!", ts);
  insertMsg.run(dmIds[2], npcIds[2], "Guild war starts in 2 hours", ts);
  insertMsg.run(dmIds[3], npcIds[3], "Can you help me craft this?", ts);
  insertMsg.run(dmIds[4], npcIds[4], "Check the new patch notes", ts);

  const jobs = [
    ["Senior 3D Artist", "Art", "Remote · Full-time", "Create stunning 3D assets for the Ninja Era world."],
    ["Backend Engineer", "Engineering", "Remote · Full-time", "Build scalable server infrastructure for our MMORPG."],
    ["Game Developer", "Game", "Remote · Part-time", "Help shape the game experience across platforms."],
    ["Blockchain Developer", "Blockchain", "Remote · Full-time", "Develop in-game NFT and token systems."],
    ["AI/ML Engineer", "AI", "Remote · Full-time", "Create intelligent NPC behavior and procedural content."],
    ["UI/UX Designer", "Design", "Remote · Full-time", "Design intuitive interfaces for web and in-game HUD."],
  ];
  const insertJob = db.prepare("INSERT INTO job_postings (title, department, employment_type, description) VALUES (?, ?, ?, ?)");
  for (const [title, dept, type, desc] of jobs) {
    insertJob.run(title, dept, type, desc);
  }

  // Team members are created only when applications are approved — no placeholder roster.

  const resources = [
    ["Beginner's Guide to Jutsu", "Guides", "Master the basics of ninjutsu, taijutsu, and combat.", null],
    ["Character Creation Walkthrough", "Guides", "Step-by-step guide to creating your shinobi.", null],
    ["Shadow Realm Wiki", "Wiki", "Complete encyclopedia of the Shadow Realm zone.", null],
    ["Clan System Overview", "Wiki", "How clans work, ranks, and territory wars.", null],
    ["Windows Client v2.4.1", "Downloads", "Latest PC game client installer.", null],
    ["Patch Notes v2.4.1", "Patch Notes", "Balance changes, bug fixes, and new content.", null],
    ["Season 4 Trailer", "Media", "Official cinematic trailer for Shadow Realm.", null],
  ];
  const insertRes = db.prepare("INSERT INTO resources (title, category, description, content_url, published_at) VALUES (?, ?, ?, ?, ?)");
  for (const [title, cat, desc, url] of resources) {
    insertRes.run(title, cat, desc, url, ts);
  }

  console.log("Database seeded successfully.");
  console.log("Demo account: ninja@example.com / password123");
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const { initSchema } = await import("./index.js");
  initSchema();
  seedDatabase();
}
