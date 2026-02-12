import discord
from discord.ext import commands
import aiosqlite
import os

DB_PATH = os.getenv("DB_PATH")


class SyncListener(commands.Cog):
    """Écoute les changements de rôles sur le serveur racine et synchronise
    automatiquement les rôles correspondants sur les serveurs cibles."""

    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        # Comparer les rôles avant/après pour détecter les changements
        roles_avant = set(before.roles)
        roles_apres = set(after.roles)

        roles_ajoutes = roles_apres - roles_avant
        roles_retires = roles_avant - roles_apres

        if not roles_ajoutes and not roles_retires:
            return

        source_guild = after.guild

        async with aiosqlite.connect(DB_PATH) as db:
            # Traiter les rôles ajoutés
            for role in roles_ajoutes:
                async with db.execute(
                    """SELECT target_guild_id, target_role_id FROM role_sync
                       WHERE source_guild_id = ? AND source_role_id = ?""",
                    (source_guild.id, role.id),
                ) as cursor:
                    rows = await cursor.fetchall()

                for target_guild_id, target_role_id in rows:
                    await self._ajouter_role(after, role, target_guild_id, target_role_id)

            # Traiter les rôles retirés
            for role in roles_retires:
                async with db.execute(
                    """SELECT target_guild_id, target_role_id FROM role_sync
                       WHERE source_guild_id = ? AND source_role_id = ?""",
                    (source_guild.id, role.id),
                ) as cursor:
                    rows = await cursor.fetchall()

                for target_guild_id, target_role_id in rows:
                    await self._retirer_role(after, role, target_guild_id, target_role_id)

    async def _ajouter_role(self, membre, source_role, target_guild_id, target_role_id):
        """Ajoute le rôle cible au membre sur le serveur cible."""
        target_guild = self.bot.get_guild(target_guild_id)
        if not target_guild:
            return

        target_role = target_guild.get_role(target_role_id)
        if not target_role:
            return

        target_membre = target_guild.get_member(membre.id)
        if not target_membre:
            # Le membre n'est pas sur le serveur cible
            return

        if target_role in target_membre.roles:
            # Il a déjà le rôle, rien à faire
            return

        try:
            await target_membre.add_roles(target_role, reason=f"Synchronisation depuis {membre.guild.name} — rôle {source_role.name}")
            await self._log_sync("Ajout automatique de rôle", membre, source_role, target_role, target_guild)
        except discord.Forbidden:
            await self._log_sync("Échec — permissions insuffisantes pour ajouter le rôle", membre, source_role, target_role, target_guild)
        except discord.HTTPException:
            await self._log_sync("Échec — erreur lors de l'ajout du rôle", membre, source_role, target_role, target_guild)

    async def _retirer_role(self, membre, source_role, target_guild_id, target_role_id):
        """Retire le rôle cible du membre sur le serveur cible."""
        target_guild = self.bot.get_guild(target_guild_id)
        if not target_guild:
            return

        target_role = target_guild.get_role(target_role_id)
        if not target_role:
            return

        target_membre = target_guild.get_member(membre.id)
        if not target_membre:
            return

        if target_role not in target_membre.roles:
            # Il n'a pas le rôle, rien à faire
            return

        try:
            await target_membre.remove_roles(target_role, reason=f"Synchronisation depuis {membre.guild.name} — rôle {source_role.name} retiré")
            await self._log_sync("Retrait automatique de rôle", membre, source_role, target_role, target_guild)
        except discord.Forbidden:
            await self._log_sync("Échec — permissions insuffisantes pour retirer le rôle", membre, source_role, target_role, target_guild)
        except discord.HTTPException:
            await self._log_sync("Échec — erreur lors du retrait du rôle", membre, source_role, target_role, target_guild)

    async def _log_sync(self, action, membre, source_role, target_role, target_guild):
        """Envoie un log d'audit pour la synchronisation automatique."""
        log_channel_name = os.getenv("LOG_CHANNEL_NAME")
        log_channel = discord.utils.get(membre.guild.text_channels, name=log_channel_name)
        if not log_channel:
            return

        embed = discord.Embed(
            title="Synchronisation automatique",
            description=f"{action}",
            color=discord.Color.orange(),
        )
        embed.add_field(name="Membre", value=membre.mention, inline=False)
        embed.add_field(name="Rôle Source", value=source_role.mention, inline=True)
        embed.add_field(name="Rôle Cible", value=f"{target_role.name} (ID: {target_role.id})", inline=True)
        embed.add_field(name="Serveur Cible", value=f"{target_guild.name} (ID: {target_guild.id})", inline=True)

        await log_channel.send(embed=embed)


async def setup(bot):
    await bot.add_cog(SyncListener(bot))
