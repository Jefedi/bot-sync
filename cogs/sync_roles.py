import discord
from discord import app_commands
from discord.ext import commands
import aiosqlite
import os

DB_PATH = os.getenv("DB_PATH")

class SyncRoles(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.tree = bot.tree  # Utiliser l'arbre des commandes pour les slash commands

    # Commande slash pour ajouter une synchronisation de rôles
    @app_commands.command(name="ajouter_sync_role", description="Synchronise deux rôles entre deux serveurs.")
    async def ajouter_sync_role(self, interaction: discord.Interaction, source_role: discord.Role, target_guild_id: int, target_role: discord.Role):
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("""
                INSERT INTO role_sync (source_guild_id, source_role_id, target_guild_id, target_role_id)
                VALUES (?, ?, ?, ?)
            """, (source_role.guild.id, source_role.id, target_guild_id, target_role.id))
            await db.commit()
        
        await interaction.response.send_message(f"Synchronisation créée entre {source_role} (source) et {target_role} (cible).", ephemeral=True)
        await self.bot.get_cog("Logging").log_action("Ajout de synchronisation", interaction, source_role, target_role, target_guild_id)

    # Commande slash pour supprimer une synchronisation de rôles
    @app_commands.command(name="supprimer_sync_role", description="Supprime une synchronisation de rôles.")
    async def supprimer_sync_role(self, interaction: discord.Interaction, source_role: discord.Role, target_guild_id: int, target_role: discord.Role):
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("""
                DELETE FROM role_sync WHERE source_guild_id = ? AND source_role_id = ? AND target_guild_id = ? AND target_role_id = ?
            """, (source_role.guild.id, source_role.id, target_guild_id, target_role.id))
            await db.commit()

        await interaction.response.send_message(f"Synchronisation supprimée entre {source_role} et {target_role}.", ephemeral=True)
        await self.bot.get_cog("Logging").log_action("Suppression de synchronisation", interaction, source_role, target_role, target_guild_id)

    # Commande slash pour voir les synchronisations de rôles
    @app_commands.command(name="voir_sync_roles", description="Affiche toutes les synchronisations de rôles.")
    async def voir_sync_roles(self, interaction: discord.Interaction):
        embed = discord.Embed(title="Synchronisations de rôles", color=discord.Color.blue())
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT source_guild_id, source_role_id, target_guild_id, target_role_id FROM role_sync") as cursor:
                rows = await cursor.fetchall()
                for row in rows:
                    source_guild_id, source_role_id, target_guild_id, target_role_id = row
                    embed.add_field(name="Source", value=f"Serveur: {source_guild_id}, Rôle: {source_role_id}", inline=True)
                    embed.add_field(name="Cible", value=f"Serveur: {target_guild_id}, Rôle: {target_role_id}", inline=True)

        await interaction.response.send_message(embed=embed)

async def setup(bot):
    await bot.add_cog(SyncRoles(bot))
