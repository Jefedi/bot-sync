import os
import discord
from discord.ext import commands
from dotenv import load_dotenv
import asyncio

# Charger les variables d'environnement depuis .env
load_dotenv()

# Charger le token et d'autres variables sensibles
TOKEN = os.getenv("DISCORD_TOKEN")
DB_PATH = os.getenv("DB_PATH")
LOG_CHANNEL_NAME = os.getenv("LOG_CHANNEL_NAME")

intents = discord.Intents.default()
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)

async def main():
    # Charger les extensions (Cogs)
    await bot.load_extension("cogs.sync_roles")
    await bot.load_extension("cogs.logging")

    # Démarrage du bot
    await bot.start(TOKEN)

# Lancer la fonction main avec asyncio.run()
if __name__ == "__main__":
    asyncio.run(main())
