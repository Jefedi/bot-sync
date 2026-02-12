# CLAUDE.md

## Project Overview

**bot-sync** est un bot Discord de synchronisation de r\u00f4les multi-serveurs. Con\u00e7u pour les communaut\u00e9s GTA RP (LSPD, BCSO, etc.), il permet de g\u00e9rer les r\u00f4les depuis un **serveur racine** et de les synchroniser automatiquement vers des **serveurs d\u00e9partementaux** o\u00f9 les r\u00f4les peuvent avoir des noms diff\u00e9rents.

Le bot est \u00e9crit en **Python** et utilise la biblioth\u00e8que **discord.py** avec l'architecture Cogs.

## Repository Structure

```
bot-sync/
\u251c\u2500\u2500 bot.py                 # Point d'entr\u00e9e \u2014 init DB, chargement des cogs, d\u00e9marrage
\u251c\u2500\u2500 cogs/
\u2502   \u251c\u2500\u2500 sync_roles.py      # Commandes slash (11 commandes avec autocomplete et cooldown)
\u2502   \u251c\u2500\u2500 sync_listener.py   # Sync automatique \u2014 \u00e9coute on_member_update, resync au d\u00e9marrage, expirations
\u2502   \u251c\u2500\u2500 logging.py         # Cog d'audit \u2014 embed de log dans un canal d\u00e9di\u00e9
\u2502   \u2514\u2500\u2500 utils.py           # Utilitaires partag\u00e9s (parser dur\u00e9e, formater dur\u00e9e, retry)
\u251c\u2500\u2500 .env                   # Variables d'environnement (DISCORD_TOKEN, DB_PATH, LOG_CHANNEL_NAME)
\u251c\u2500\u2500 .env.example           # Template des variables d'environnement
\u251c\u2500\u2500 .gitignore             # Exclusions (.env, *.db, __pycache__/, venv/, IDE)
\u251c\u2500\u2500 requirements.txt       # D\u00e9pendances Python (discord.py, aiosqlite, python-dotenv)
\u251c\u2500\u2500 sync_roles.db          # Base SQLite (cr\u00e9\u00e9e automatiquement au d\u00e9marrage)
\u2514\u2500\u2500 CLAUDE.md              # Ce fichier
```

## Tech Stack

- **Langage :** Python 3.11+
- **Framework bot :** discord.py (avec `commands.Bot` et `app_commands` pour les slash commands)
- **Base de donn\u00e9es :** SQLite via `aiosqlite` (async)
- **Config :** `python-dotenv` pour le chargement du `.env`

## Architecture

Le bot suit le **pattern Cogs de discord.py** pour une organisation modulaire :

### `bot.py` \u2014 Point d'entr\u00e9e

- Charge `.env`, configure les intents (`members` requis)
- **Initialise automatiquement la base de donn\u00e9es** (`init_db()`) avec cr\u00e9ation des tables et index
- Charge les 3 cogs : `sync_roles`, `logging`, `sync_listener`
- D\u00e9marre le bot via `asyncio.run()`

### `cogs/sync_roles.py` \u2014 Commandes slash (`SyncRoles`)

11 commandes slash avec autocompl\u00e9tion, cooldown et v\u00e9rification des permissions :

| Commande | Description | Cooldown |
|----------|-------------|----------|
| `/aide` | Affiche l'aide compl\u00e8te du bot | Non |
| `/bot_status` | Dashboard : \u00e9tat, stats, permissions, syncs orphelines | Non |
| `/ajouter_sync_role` | Cr\u00e9er une correspondance de r\u00f4les (avec v\u00e9rification hi\u00e9rarchie) | 5s |
| `/supprimer_sync_role` | Supprimer une correspondance | 5s |
| `/voir_sync_roles` | Voir toutes les correspondances du serveur (filtr\u00e9 par guild) | Non |
| `/resync @membre` | Resynchroniser les r\u00f4les d'un membre (embed d\u00e9taill\u00e9 par serveur) | Non |
| `/nettoyer_sync` | Supprimer les syncs orphelines (r\u00f4le/serveur supprim\u00e9) | Non |
| `/copier_sync` | Copier les configs d'un serveur cible vers un autre | 5s |
| `/exporter_config` | Exporter la configuration en fichier JSON | Non |
| `/importer_config` | Importer une configuration depuis un fichier JSON | 5s |

**Fonctionnalit\u00e9s cl\u00e9s :**
- **Autocomplete** sur les param\u00e8tres serveur (`autocomplete_serveur()`) et r\u00f4le cible (`autocomplete_role_cible()`)
- **V\u00e9rification de la hi\u00e9rarchie** des r\u00f4les avant la cr\u00e9ation d'un mapping (le r\u00f4le cible doit \u00eatre en-dessous du r\u00f4le du bot)
- **Cooldown anti-spam** de 5 secondes sur les commandes de modification
- **`@default_permissions(administrator=True)`** sur toutes les commandes d'administration
- **Gestion des erreurs** avec `try/except` et messages utilisateur
- **Appel s\u00e9curis\u00e9 au Logging** via `_get_logging_cog()` (pas d'erreur si le cog est absent)

### `cogs/sync_listener.py` \u2014 Sync automatique (`SyncListener`)

- **`on_member_update`** : d\u00e9tecte les ajouts/retraits de r\u00f4les en temps r\u00e9el et synchronise vers les serveurs cibles
- **`on_ready`** : resync compl\u00e8te au d\u00e9marrage avec rate limiting (`RESYNC_DELAI = 0.5s` entre chaque appel API)
- **`verifier_expirations`** : t\u00e2che de fond (toutes les minutes) qui retire les r\u00f4les dont la dur\u00e9e a expir\u00e9
- **Retry avec backoff exponentiel** via `avec_retry()` sur tous les appels API Discord (ajout/retrait de r\u00f4les)
- **Logs d\u00e9taill\u00e9s** avec embed color\u00e9 (vert=ajout, orange=retrait, rouge=erreur)

### `cogs/logging.py` \u2014 Audit (`Logging`)

- Fournit `log_action()` qui poste des embeds d'audit dans le canal configur\u00e9 par `LOG_CHANNEL_NAME`

### `cogs/utils.py` \u2014 Utilitaires partag\u00e9s

| Fonction | Description |
|----------|-------------|
| `parser_duree(texte)` | Convertit `7j`, `12h`, `30m`, `1j12h` en minutes (max 365j) |
| `formater_duree(minutes)` | Formate des minutes en texte lisible (`3j 12h`) |
| `avec_retry(coro_func, ...)` | Retry avec backoff exponentiel (3 tentatives, ignore 4xx sauf 429) |

### Communication inter-cogs

`SyncRoles` appelle `self._log()` qui v\u00e9rifie l'existence du cog `Logging` avant d'appeler `log_action()`. Ce pattern \u00e9vite les erreurs si le cog n'est pas charg\u00e9.

## Sch\u00e9ma de base de donn\u00e9es

La base SQLite contient 2 tables, cr\u00e9\u00e9es automatiquement au d\u00e9marrage par `init_db()` :

```sql
-- Table des correspondances de r\u00f4les
CREATE TABLE role_sync (
    source_guild_id INTEGER,
    source_role_id INTEGER,
    target_guild_id INTEGER,
    target_role_id INTEGER,
    duree_minutes INTEGER,          -- Dur\u00e9e en minutes (NULL = permanent)
    note TEXT,                       -- Note optionnelle (max 200 caract\u00e8res)
    UNIQUE(source_guild_id, source_role_id, target_guild_id, target_role_id)
);

-- Table de suivi des syncs actifs (pour l'expiration des dur\u00e9es)
CREATE TABLE role_sync_actif (
    member_id INTEGER,
    source_guild_id INTEGER,
    source_role_id INTEGER,
    target_guild_id INTEGER,
    target_role_id INTEGER,
    synced_at REAL,                  -- Timestamp Unix du moment de la sync
    UNIQUE(member_id, source_guild_id, source_role_id, target_guild_id, target_role_id)
);

-- Index pour acc\u00e9l\u00e9rer les recherches
CREATE INDEX idx_role_sync_source ON role_sync (source_guild_id, source_role_id);
CREATE INDEX idx_role_sync_actif_source ON role_sync_actif (source_guild_id, source_role_id);
```

## Variables d'environnement

D\u00e9finies dans `.env` (voir `.env.example` pour le template) :

| Variable           | Description                                         |
|--------------------|-----------------------------------------------------|
| `DISCORD_TOKEN`    | Token d'authentification du bot                     |
| `DB_PATH`          | Chemin vers la base SQLite (ex: `sync_roles.db`)    |
| `LOG_CHANNEL_NAME` | Nom du canal textuel Discord pour les logs d'audit  |

## Comment lancer

```bash
# Installer les d\u00e9pendances
pip install -r requirements.txt

# Configurer le .env (copier depuis .env.example)
cp .env.example .env
# \u00c9diter .env avec vos valeurs

# D\u00e9marrer le bot
python bot.py
```

## Conventions de d\u00e9veloppement

### Langue

- **Les commentaires et textes UI sont en fran\u00e7ais.** Suivre cette convention pour tout nouveau texte.
- Nommage Python en **snake_case** (PEP 8).
- Noms de commandes slash en fran\u00e7ais : `ajouter`, `supprimer`, `voir`, `resync`, `nettoyer`, `copier`, `exporter`, `importer`.

### Patterns \u00e0 suivre

1. **Architecture Cogs** \u2014 Nouvelles fonctionnalit\u00e9s en nouveaux cogs dans `cogs/` avec `async def setup(bot)`.
2. **Async/await partout** \u2014 Toutes les op\u00e9rations bot et DB sont async.
3. **Requ\u00eates SQL param\u00e9tr\u00e9es** \u2014 Toujours utiliser `?` comme placeholders, jamais de f-strings.
4. **R\u00e9ponses \u00e9ph\u00e9m\u00e8res** \u2014 Les commandes de mutation r\u00e9pondent avec `ephemeral=True`.
5. **Log d'audit** \u2014 Toute action utilisateur appelle `self._log(...)` apr\u00e8s ex\u00e9cution.
6. **Gestion des erreurs** \u2014 `try/except` sur toutes les commandes avec message utilisateur en cas d'erreur.
7. **Retry sur les appels API** \u2014 Utiliser `avec_retry()` pour les appels Discord susceptibles de rate limit.
8. **Contraintes UNIQUE en DB** \u2014 G\u00e9rer `aiosqlite.IntegrityError` pour les doublons.
9. **Cooldown anti-spam** \u2014 `@app_commands.checks.cooldown(1, 5.0)` sur les commandes de modification.
10. **`@default_permissions(administrator=True)`** sur les commandes d'administration.

### Ajouter un nouveau cog

1. Cr\u00e9er un fichier dans `cogs/` (ex: `cogs/ma_fonctionnalite.py`).
2. D\u00e9finir une classe qui \u00e9tend `commands.Cog`.
3. Ajouter `async def setup(bot)` au niveau du module.
4. Charger dans `bot.py` avec `await bot.load_extension("cogs.ma_fonctionnalite")`.

### Limitations connues

- **Pas de tests** \u2014 Aucun framework de test configur\u00e9.
- **Pas de CI/CD** \u2014 Aucun pipeline GitHub Actions.
- **Un seul canal de log** \u2014 Tous les logs vont dans le m\u00eame canal (`LOG_CHANNEL_NAME`).
