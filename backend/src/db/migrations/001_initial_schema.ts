import type { Migration } from "./runner.js";

/**
 * Base schema for new installs. Merges the original `initSchema()` tables with
 * every additive column/table introduced later by the legacy `runMigrations()`
 * (see ../migrations.ts), so a brand-new database gets the full, final shape
 * in a single pass. Existing SQLite databases created before this versioned
 * migration system will have most of this already applied; see
 * `002_legacy_columns` for backfilling anything they're missing.
 */
export const migration001: Migration = {
  id: "001_initial_schema",

  async upSqlite(db) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        avatar_url TEXT,
        gender TEXT DEFAULT 'Prefer not to say',
        date_of_birth TEXT,
        country TEXT DEFAULT 'Japan',
        city TEXT,
        status TEXT DEFAULT 'Online',
        bio TEXT DEFAULT '',
        member_since TEXT NOT NULL,
        village TEXT DEFAULT 'Leaf Village',
        clan TEXT DEFAULT 'Dragon Clan',
        level INTEGER DEFAULT 1,
        rank TEXT DEFAULT 'Genin',
        is_npc INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 0,
        is_disabled INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        is_team_member INTEGER DEFAULT 0,
        is_online INTEGER DEFAULT 0,
        last_seen_at TEXT,
        last_login_at TEXT,
        channel_reads_initialized INTEGER DEFAULT 0,
        email_verified INTEGER DEFAULT 1,
        email_verified_at TEXT,
        token_version INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        email_notif INTEGER DEFAULT 1,
        push_notif INTEGER DEFAULT 0,
        two_fa INTEGER DEFAULT 0,
        public_profile INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS game_stats (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        missions_complete INTEGER DEFAULT 0,
        pvp_wins INTEGER DEFAULT 0,
        playtime_hours INTEGER DEFAULT 0,
        legendary_items INTEGER DEFAULT 0,
        ninjutsu INTEGER DEFAULT 0,
        taijutsu INTEGER DEFAULT 0,
        genjutsu INTEGER DEFAULT 0,
        senjutsu INTEGER DEFAULT 0,
        kenjutsu INTEGER DEFAULT 0,
        global_rank INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT 'star',
        earned_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        rarity TEXT DEFAULT 'common',
        quantity INTEGER DEFAULT 1,
        icon TEXT DEFAULT 'diamond'
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source TEXT DEFAULT 'Operations',
        page TEXT DEFAULT 'alarms',
        recipient_type TEXT DEFAULT 'everyone',
        recipient_ids TEXT DEFAULT '[]',
        pinned INTEGER DEFAULT 0,
        notif_type TEXT DEFAULT 'announcement',
        metadata TEXT DEFAULT '{}',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_reads (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        read_at TEXT NOT NULL,
        PRIMARY KEY (user_id, notification_id)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('channel', 'dm')),
        name TEXT NOT NULL,
        bio TEXT DEFAULT '',
        archived INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'public',
        moderator_ids TEXT DEFAULT '[]',
        avatar_url TEXT,
        last_message_at TEXT,
        last_message_preview TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_participants (
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        muted INTEGER DEFAULT 0,
        last_read_at TEXT,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (conversation_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT DEFAULT '',
        media_url TEXT,
        media_type TEXT,
        file_name TEXT,
        file_size INTEGER,
        duration_ms INTEGER,
        media_meta TEXT,
        reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        edited_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, emoji, user_id)
      );

      CREATE TABLE IF NOT EXISTS blocks (
        blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (blocker_id, blocked_id)
      );

      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        reason TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contact_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        guest_identifier TEXT,
        ip_address TEXT,
        country TEXT,
        country_code TEXT,
        is_read INTEGER DEFAULT 0,
        reply_status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        subscribed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_postings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        department TEXT NOT NULL,
        employment_type TEXT NOT NULL,
        description TEXT DEFAULT '',
        active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS job_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        gender TEXT,
        date_of_birth TEXT,
        country TEXT,
        city TEXT,
        photo_url TEXT,
        cv_url TEXT,
        portfolio_url TEXT,
        message TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        department TEXT NOT NULL,
        country TEXT NOT NULL,
        city TEXT NOT NULL,
        status_label TEXT,
        status_color TEXT,
        sort_order INTEGER DEFAULT 0,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT DEFAULT '',
        content_url TEXT,
        published_at TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        file_size INTEGER,
        version TEXT,
        sort_order INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'PUBLIC'
      );

      CREATE TABLE IF NOT EXISTS characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        village TEXT NOT NULL,
        role TEXT NOT NULL,
        rarity TEXT NOT NULL,
        clan TEXT NOT NULL,
        color TEXT NOT NULL,
        image_url TEXT,
        bio TEXT DEFAULT '',
        stats_atk INTEGER DEFAULT 0,
        stats_def INTEGER DEFAULT 0,
        stats_spd INTEGER DEFAULT 0,
        stats_mgk INTEGER DEFAULT 0,
        abilities TEXT DEFAULT '[]',
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS user_locations (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        ip_address TEXT,
        country_code TEXT,
        country_name TEXT,
        is_vpn INTEGER DEFAULT 0,
        vpn_ip TEXT,
        vpn_country_code TEXT,
        vpn_country_name TEXT,
        origin_ip TEXT,
        origin_country_code TEXT,
        origin_country_name TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dm_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(requester_id, recipient_id)
      );

      CREATE TABLE IF NOT EXISTS dm_contacts (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contact_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, contact_user_id)
      );

      CREATE TABLE IF NOT EXISTS game_downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL CHECK(platform IN ('windows', 'android', 'ios')),
        version TEXT NOT NULL,
        release_notes TEXT DEFAULT '',
        file_url TEXT,
        file_size INTEGER,
        published INTEGER DEFAULT 0,
        published_at TEXT,
        uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username TEXT,
        display_name TEXT,
        user_role TEXT DEFAULT 'guest',
        event_type TEXT NOT NULL,
        event_category TEXT NOT NULL,
        description TEXT NOT NULL,
        affected_object TEXT,
        request_path TEXT,
        http_method TEXT,
        user_agent TEXT,
        browser TEXT,
        os TEXT,
        device_type TEXT,
        session_id TEXT,
        ip_address TEXT,
        country TEXT,
        country_code TEXT,
        is_vpn INTEGER,
        result TEXT DEFAULT 'success',
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contact_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL REFERENCES contact_tickets(id) ON DELETE CASCADE,
        admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_oauth_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('google', 'github', 'discord')),
        provider_user_id TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        UNIQUE(provider, provider_user_id),
        UNIQUE(user_id, provider)
      );

      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_action_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        admin_username TEXT,
        action TEXT NOT NULL,
        method TEXT,
        item_count INTEGER DEFAULT 0,
        details TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        last_sent_at TEXT NOT NULL,
        attempt_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_cursor ON messages(conversation_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dm_requests_recipient ON dm_requests(recipient_id, status);
      CREATE INDEX IF NOT EXISTS idx_dm_requests_requester ON dm_requests(requester_id, status);
      CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);
      CREATE INDEX IF NOT EXISTS idx_game_downloads_platform ON game_downloads(platform, published);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(event_category);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_event ON activity_logs(event_type);
      CREATE INDEX IF NOT EXISTS idx_contact_replies_ticket ON contact_replies(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_providers_user ON user_oauth_providers(user_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_providers_lookup ON user_oauth_providers(provider, provider_user_id);
      CREATE INDEX IF NOT EXISTS idx_admin_action_audits_timestamp ON admin_action_audits(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);
      CREATE INDEX IF NOT EXISTS idx_notification_reads_notif ON notification_reads(notification_id);
      CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_pending_reg_expires ON pending_registrations(expires_at);
      CREATE INDEX IF NOT EXISTS idx_pending_reg_username ON pending_registrations(LOWER(username));
      -- NOTE: idx_notifications_user, idx_users_admin, idx_users_npc_deleted,
      -- idx_users_username_lower, idx_contact_tickets_read, idx_contact_tickets_reply,
      -- idx_resources_enabled_sort and idx_conversations_type_archived index columns
      -- that are additive on pre-existing tables. They are created in
      -- 002_legacy_columns AFTER those columns are guaranteed to exist, so this
      -- migration never fails against a legacy database that predates them.
    `);
  },

  async upPostgres(db) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        avatar_url TEXT,
        gender TEXT DEFAULT 'Prefer not to say',
        date_of_birth TEXT,
        country TEXT DEFAULT 'Japan',
        city TEXT,
        status TEXT DEFAULT 'Online',
        bio TEXT DEFAULT '',
        member_since TEXT NOT NULL,
        village TEXT DEFAULT 'Leaf Village',
        clan TEXT DEFAULT 'Dragon Clan',
        level INTEGER DEFAULT 1,
        rank TEXT DEFAULT 'Genin',
        is_npc INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 0,
        is_disabled INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        is_team_member INTEGER DEFAULT 0,
        is_online INTEGER DEFAULT 0,
        last_seen_at TEXT,
        last_login_at TEXT,
        channel_reads_initialized INTEGER DEFAULT 0,
        email_verified INTEGER DEFAULT 1,
        email_verified_at TEXT,
        token_version INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        email_notif INTEGER DEFAULT 1,
        push_notif INTEGER DEFAULT 0,
        two_fa INTEGER DEFAULT 0,
        public_profile INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS game_stats (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        missions_complete INTEGER DEFAULT 0,
        pvp_wins INTEGER DEFAULT 0,
        playtime_hours INTEGER DEFAULT 0,
        legendary_items INTEGER DEFAULT 0,
        ninjutsu INTEGER DEFAULT 0,
        taijutsu INTEGER DEFAULT 0,
        genjutsu INTEGER DEFAULT 0,
        senjutsu INTEGER DEFAULT 0,
        kenjutsu INTEGER DEFAULT 0,
        global_rank INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS achievements (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT 'star',
        earned_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_items (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        rarity TEXT DEFAULT 'common',
        quantity INTEGER DEFAULT 1,
        icon TEXT DEFAULT 'diamond'
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source TEXT DEFAULT 'Operations',
        page TEXT DEFAULT 'alarms',
        recipient_type TEXT DEFAULT 'everyone',
        recipient_ids TEXT DEFAULT '[]',
        pinned INTEGER DEFAULT 0,
        notif_type TEXT DEFAULT 'announcement',
        metadata TEXT DEFAULT '{}',
        created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_reads (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        read_at TEXT NOT NULL,
        PRIMARY KEY (user_id, notification_id)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id BIGSERIAL PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('channel', 'dm')),
        name TEXT NOT NULL,
        bio TEXT DEFAULT '',
        archived INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'public',
        moderator_ids TEXT DEFAULT '[]',
        avatar_url TEXT,
        last_message_at TEXT,
        last_message_preview TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_participants (
        conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        muted INTEGER DEFAULT 0,
        last_read_at TEXT,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (conversation_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT DEFAULT '',
        media_url TEXT,
        media_type TEXT,
        file_name TEXT,
        file_size INTEGER,
        duration_ms INTEGER,
        media_meta TEXT,
        reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
        edited_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, emoji, user_id)
      );

      CREATE TABLE IF NOT EXISTS blocks (
        blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (blocker_id, blocked_id)
      );

      CREATE TABLE IF NOT EXISTS reports (
        id BIGSERIAL PRIMARY KEY,
        reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
        reason TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contact_tickets (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        guest_identifier TEXT,
        ip_address TEXT,
        country TEXT,
        country_code TEXT,
        is_read INTEGER DEFAULT 0,
        reply_status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        subscribed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_postings (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        department TEXT NOT NULL,
        employment_type TEXT NOT NULL,
        description TEXT DEFAULT '',
        active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS job_applications (
        id BIGSERIAL PRIMARY KEY,
        job_id BIGINT NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        gender TEXT,
        date_of_birth TEXT,
        country TEXT,
        city TEXT,
        photo_url TEXT,
        cv_url TEXT,
        portfolio_url TEXT,
        message TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_members (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        department TEXT NOT NULL,
        country TEXT NOT NULL,
        city TEXT NOT NULL,
        status_label TEXT,
        status_color TEXT,
        sort_order INTEGER DEFAULT 0,
        user_id BIGINT REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS resources (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT DEFAULT '',
        content_url TEXT,
        published_at TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        uploader_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        file_size INTEGER,
        version TEXT,
        sort_order INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'PUBLIC'
      );

      CREATE TABLE IF NOT EXISTS characters (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        village TEXT NOT NULL,
        role TEXT NOT NULL,
        rarity TEXT NOT NULL,
        clan TEXT NOT NULL,
        color TEXT NOT NULL,
        image_url TEXT,
        bio TEXT DEFAULT '',
        stats_atk INTEGER DEFAULT 0,
        stats_def INTEGER DEFAULT 0,
        stats_spd INTEGER DEFAULT 0,
        stats_mgk INTEGER DEFAULT 0,
        abilities TEXT DEFAULT '[]',
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS user_locations (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        ip_address TEXT,
        country_code TEXT,
        country_name TEXT,
        is_vpn INTEGER DEFAULT 0,
        vpn_ip TEXT,
        vpn_country_code TEXT,
        vpn_country_name TEXT,
        origin_ip TEXT,
        origin_country_code TEXT,
        origin_country_name TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dm_requests (
        id BIGSERIAL PRIMARY KEY,
        requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(requester_id, recipient_id)
      );

      CREATE TABLE IF NOT EXISTS dm_contacts (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contact_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, contact_user_id)
      );

      CREATE TABLE IF NOT EXISTS game_downloads (
        id BIGSERIAL PRIMARY KEY,
        platform TEXT NOT NULL CHECK(platform IN ('windows', 'android', 'ios')),
        version TEXT NOT NULL,
        release_notes TEXT DEFAULT '',
        file_url TEXT,
        file_size INTEGER,
        published INTEGER DEFAULT 0,
        published_at TEXT,
        uploader_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id BIGSERIAL PRIMARY KEY,
        timestamp TEXT NOT NULL,
        user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        username TEXT,
        display_name TEXT,
        user_role TEXT DEFAULT 'guest',
        event_type TEXT NOT NULL,
        event_category TEXT NOT NULL,
        description TEXT NOT NULL,
        affected_object TEXT,
        request_path TEXT,
        http_method TEXT,
        user_agent TEXT,
        browser TEXT,
        os TEXT,
        device_type TEXT,
        session_id TEXT,
        ip_address TEXT,
        country TEXT,
        country_code TEXT,
        is_vpn INTEGER,
        result TEXT DEFAULT 'success',
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contact_replies (
        id BIGSERIAL PRIMARY KEY,
        ticket_id BIGINT NOT NULL REFERENCES contact_tickets(id) ON DELETE CASCADE,
        admin_id BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_oauth_providers (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('google', 'github', 'discord')),
        provider_user_id TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        UNIQUE(provider, provider_user_id),
        UNIQUE(user_id, provider)
      );

      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_action_audits (
        id BIGSERIAL PRIMARY KEY,
        timestamp TEXT NOT NULL,
        admin_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        admin_username TEXT,
        action TEXT NOT NULL,
        method TEXT,
        item_count INTEGER DEFAULT 0,
        details TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_registrations (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        last_sent_at TEXT NOT NULL,
        attempt_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_cursor ON messages(conversation_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dm_requests_recipient ON dm_requests(recipient_id, status);
      CREATE INDEX IF NOT EXISTS idx_dm_requests_requester ON dm_requests(requester_id, status);
      CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);
      CREATE INDEX IF NOT EXISTS idx_game_downloads_platform ON game_downloads(platform, published);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(event_category);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_event ON activity_logs(event_type);
      CREATE INDEX IF NOT EXISTS idx_contact_replies_ticket ON contact_replies(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_providers_user ON user_oauth_providers(user_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_providers_lookup ON user_oauth_providers(provider, provider_user_id);
      CREATE INDEX IF NOT EXISTS idx_admin_action_audits_timestamp ON admin_action_audits(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);
      CREATE INDEX IF NOT EXISTS idx_notification_reads_notif ON notification_reads(notification_id);
      CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_pending_reg_expires ON pending_registrations(expires_at);
      CREATE INDEX IF NOT EXISTS idx_pending_reg_username ON pending_registrations(LOWER(username));
      -- NOTE: idx_notifications_user, idx_users_admin, idx_users_npc_deleted,
      -- idx_users_username_lower, idx_contact_tickets_read, idx_contact_tickets_reply,
      -- idx_resources_enabled_sort and idx_conversations_type_archived index columns
      -- that are additive on pre-existing tables. They are created in
      -- 002_legacy_columns AFTER those columns are guaranteed to exist, so this
      -- migration never fails against a legacy database that predates them.
    `);
  },
};
