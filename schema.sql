-- ============================================
-- Schéma Supabase pour Bot Polyvalent v2.0
-- Exécuter dans l'éditeur SQL de Supabase
-- ============================================

-- Configuration par serveur
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    prefix TEXT DEFAULT '!',
    log_channel_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Noms des niveaux de permission par serveur (1-9)
CREATE TABLE IF NOT EXISTS permission_levels (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    level INT NOT NULL CHECK (level >= 1 AND level <= 9),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, level),
    UNIQUE(guild_id, name)
);

-- Permissions des utilisateurs
CREATE TABLE IF NOT EXISTS user_permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    permission_level INT NOT NULL CHECK (permission_level >= 1 AND permission_level <= 9),
    assigned_by TEXT NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id)
);

-- Niveau requis par commande (configurable par serveur)
CREATE TABLE IF NOT EXISTS command_permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    command_name TEXT NOT NULL,
    permission_level INT NOT NULL CHECK (permission_level >= 1 AND permission_level <= 9),
    UNIQUE(guild_id, command_name)
);

-- Configuration des services par serveur (GitLab, Jellyfin, etc.)
CREATE TABLE IF NOT EXISTS service_configs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    service TEXT NOT NULL,
    config_key TEXT NOT NULL,
    config_value TEXT NOT NULL,
    is_secret BOOLEAN DEFAULT FALSE,
    configured_by TEXT NOT NULL,
    configured_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, service, config_key)
);

-- Mappings de synchronisation de rôles
CREATE TABLE IF NOT EXISTS role_sync (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    source_guild_id TEXT NOT NULL,
    source_role_id TEXT NOT NULL,
    target_guild_id TEXT NOT NULL,
    target_role_id TEXT NOT NULL,
    duration_minutes INT DEFAULT NULL,
    note TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_guild_id, source_role_id, target_guild_id, target_role_id)
);

-- Syncs actifs (suivi d'expiration des durées)
CREATE TABLE IF NOT EXISTS role_sync_active (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    member_id TEXT NOT NULL,
    source_guild_id TEXT NOT NULL,
    source_role_id TEXT NOT NULL,
    target_guild_id TEXT NOT NULL,
    target_role_id TEXT NOT NULL,
    synced_at DOUBLE PRECISION NOT NULL,
    reminder_sent BOOLEAN DEFAULT FALSE,
    UNIQUE(member_id, source_guild_id, source_role_id, target_guild_id, target_role_id)
);

-- Historique d'audit (unifié pour tous les modules)
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    user_id TEXT,
    user_tag TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_audit_log_guild ON audit_log(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_module ON audit_log(guild_id, module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_sync_source ON role_sync(source_guild_id);
CREATE INDEX IF NOT EXISTS idx_role_sync_target ON role_sync(target_guild_id);
CREATE INDEX IF NOT EXISTS idx_role_sync_active_member ON role_sync_active(member_id);
CREATE INDEX IF NOT EXISTS idx_service_configs_guild ON service_configs(guild_id, service);
CREATE INDEX IF NOT EXISTS idx_user_permissions_guild ON user_permissions(guild_id);
CREATE INDEX IF NOT EXISTS idx_command_permissions_guild ON command_permissions(guild_id);
