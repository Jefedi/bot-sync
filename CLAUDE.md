# CLAUDE.md

## Project Overview

**bot-sync** is a Discord bot for synchronizing roles across multiple Discord servers (guilds). It allows administrators to create, delete, and view role synchronization mappings between a source server and a target server. All actions are logged to a designated audit channel.

The bot is written in **Python** and uses the **discord.py** library with the Cogs extension architecture.

## Repository Structure

```
bot-sync/
├── bot.py                 # Main entry point — loads cogs and starts the bot
├── cogs/
│   ├── sync_roles.py      # Core role synchronization logic (slash commands)
│   └── logging.py         # Audit logging cog — posts action embeds to a log channel
├── .env                   # Environment variables (DISCORD_TOKEN, DB_PATH, LOG_CHANNEL_NAME)
├── requirements.txt       # Python dependencies (currently empty)
├── sync_roles.db          # SQLite database file for role sync mappings
└── CLAUDE.md              # This file
```

## Tech Stack

- **Language:** Python 3.11+
- **Bot framework:** discord.py (with `commands.Bot` and `app_commands` for slash commands)
- **Database:** SQLite via `aiosqlite` (async)
- **Config:** `python-dotenv` for `.env` loading

## Architecture

The bot follows the **discord.py Cogs pattern** for modular organization:

- **`bot.py`** — Entry point. Loads `.env`, configures intents (members intent required), loads cogs, and starts the bot via `asyncio.run()`.
- **`cogs/sync_roles.py`** (`SyncRoles` cog) — Exposes three slash commands:
  - `/ajouter_sync_role` — Inserts a role sync mapping into the `role_sync` SQLite table
  - `/supprimer_sync_role` — Deletes a role sync mapping
  - `/voir_sync_roles` — Queries and displays all active sync mappings as an embed
- **`cogs/logging.py`** (`Logging` cog) — Provides `log_action()` method that posts audit embed messages to the channel named by `LOG_CHANNEL_NAME`.

### Inter-cog communication

`SyncRoles` calls `self.bot.get_cog("Logging").log_action(...)` directly after each command. This is a tight coupling — the `Logging` cog must be loaded for sync commands to work without errors.

### Database schema

The SQLite database (`sync_roles.db`) uses a single table:

```sql
CREATE TABLE role_sync (
    source_guild_id INTEGER,
    source_role_id INTEGER,
    target_guild_id INTEGER,
    target_role_id INTEGER
);
```

Note: The schema is not auto-created by the bot code. The database file must have this table pre-created.

## Environment Variables

Defined in `.env` at the project root:

| Variable           | Purpose                                      |
|--------------------|----------------------------------------------|
| `DISCORD_TOKEN`    | Bot authentication token                     |
| `DB_PATH`          | Path to the SQLite database (e.g. `sync_roles.db`) |
| `LOG_CHANNEL_NAME` | Name of the Discord text channel for audit logs |

## How to Run

```bash
# Install dependencies
pip install discord.py aiosqlite python-dotenv

# Ensure .env is configured with valid values

# Start the bot
python bot.py
```

## Development Notes

### Language conventions

- **Comments and UI strings are in French.** Follow this convention when adding new user-facing text or code comments.
- Python code follows **snake_case** naming (PEP 8).
- Slash command names use French verbs: `ajouter` (add), `supprimer` (delete), `voir` (view).

### Key patterns to follow

1. **Cog-based architecture** — New features should be added as new cogs in the `cogs/` directory with an `async def setup(bot)` function.
2. **Async/await everywhere** — All bot operations and database calls are async.
3. **Parameterized SQL queries** — Always use `?` placeholders, never f-strings, for database queries.
4. **Ephemeral responses** — Mutation commands (`ajouter`, `supprimer`) reply with `ephemeral=True`. Read-only commands (`voir`) are public.
5. **Audit logging** — All user-facing actions should call `self.bot.get_cog("Logging").log_action(...)` after execution.

### Known limitations

- **No error handling** — Commands have no try/except blocks; failures will surface as unhandled exceptions.
- **No database initialization** — The `role_sync` table must be manually created before first use.
- **Empty `requirements.txt`** — Dependencies are not listed; expected packages are `discord.py`, `aiosqlite`, `python-dotenv`.
- **No `.gitignore`** — `.env`, `__pycache__/`, and `*.db` are not excluded from version control.
- **No tests** — There is no test suite or testing framework configured.
- **No CI/CD** — No GitHub Actions or other pipeline configuration exists.

### Adding a new cog

1. Create a new file in `cogs/` (e.g. `cogs/my_feature.py`).
2. Define a class extending `commands.Cog`.
3. Add an `async def setup(bot)` function at module level that calls `await bot.add_cog(MyFeature(bot))`.
4. Load it in `bot.py` by adding `await bot.load_extension("cogs.my_feature")` inside `main()`.
