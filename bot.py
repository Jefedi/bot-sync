import os
import discord
from discord.ext import commands
from dotenv import load_dotenv
import asyncio
import aiosqlite

# Charger les variables d'environnement depuis .env
load_dotenv()

# Charger le token et d'autres variables sensibles
TOKEN = os.getenv("DISCORD_TOKEN")
DB_PATH = os.getenv("DB_PATH")
LOG_CHANNEL_NAME = os.getenv("LOG_CHANNEL_NAME")

intents = discord.Intents.default()
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)


async def init_db():
    """Initialise la base de données et crée les tables si elles n'existent pas."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS role_sync (
                source_guild_id INTEGER,
                source_role_id INTEGER,
                target_guild_id INTEGER,
                target_role_id INTEGER,
                duree_minutes INTEGER,
                note TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS role_sync_actif (
                member_id INTEGER,
                source_guild_id INTEGER,
                source_role_id INTEGER,
                target_guild_id INTEGER,
                target_role_id INTEGER,
                synced_at REAL
            )
        """)
        await db.commit()
    print("Base de données initialisée.")


async def main():
    # Initialiser la base de données
    await init_db()

    # Charger les extensions (Cogs)
    await bot.load_extension("cogs.sync_roles")
    await bot.load_extension("cogs.logging")
    await bot.load_extension("cogs.sync_listener")

    # Démarrage du bot
    await bot.start(TOKEN)

# Lancer la fonction main avec asyncio.run()
if __name__ == "__main__":
    asyncio.run(main())
