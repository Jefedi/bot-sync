import discord
from discord.ext import commands
import os

LOG_CHANNEL_NAME = os.getenv("LOG_CHANNEL_NAME")

class Logging(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def log_action(self, action, interaction, source_role=None, target_role=None, target_guild_id=None):
        log_channel = discord.utils.get(interaction.guild.text_channels, name=LOG_CHANNEL_NAME)
        if not log_channel:
            return
        
        embed = discord.Embed(title="Journalisation d'une action", description=f"{action} a été effectuée.", color=discord.Color.green())
        embed.add_field(name="Utilisateur", value=interaction.user.mention, inline=False)
        if source_role:
            embed.add_field(name="Rôle Source", value=source_role.mention, inline=True)
        if target_role:
            embed.add_field(name="Rôle Cible", value=target_role.mention, inline=True)
        if target_guild_id:
            embed.add_field(name="Serveur Cible", value=f"ID : {target_guild_id}", inline=True)
        
        await log_channel.send(embed=embed)

async def setup(bot):
    await bot.add_cog(Logging(bot))
