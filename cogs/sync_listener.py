import discord
from discord.ext import commands
import aiosqlite
import os

DB_PATH = os.getenv("DB_PATH")


class SyncListener(commands.Cog):
    """Écoute les changements de rôles sur le serveur racine et synchronise
    automatiquement les rôles correspondants sur les serveurs cibles.
    Au démarrage du bot, effectue un resync complet pour rattraper les changements manqués."""

    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_ready(self):
        """Resynchronisation complète au démarrage du bot."""
        print("Resynchronisation des rôles au démarrage...")
        ajouts = 0
        retraits = 0

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT source_guild_id, source_role_id, target_guild_id, target_role_id FROM role_sync"
            ) as cursor:
                mappings = await cursor.fetchall()

        for source_guild_id, source_role_id, target_guild_id, target_role_id in mappings:
            source_guild = self.bot.get_guild(source_guild_id)
            target_guild = self.bot.get_guild(target_guild_id)
            if not source_guild or not target_guild:
                continue

            source_role = source_guild.get_role(source_role_id)
            target_role = target_guild.get_role(target_role_id)
            if not source_role or not target_role:
                continue

            # Pour chaque membre du serveur source, vérifier la cohérence
            for membre in source_guild.members:
                target_membre = target_guild.get_member(membre.id)
                if not target_membre:
                    # Le membre n'est pas sur le serveur cible, on passe
                    continue

                a_le_role_source = source_role in membre.roles
                a_le_role_cible = target_role in target_membre.roles

                if a_le_role_source and not a_le_role_cible:
                    # Il a le rôle sur le serveur racine mais pas sur la cible → ajouter
                    try:
                        await target_membre.add_roles(
                            target_role,
                            reason=f"Resync au démarrage — rôle {source_role.name}",
                        )
                        ajouts += 1
                    except (discord.Forbidden, discord.HTTPException):
                        pass

                elif not a_le_role_source and a_le_role_cible:
                    # Il n'a plus le rôle sur le serveur racine mais l'a encore sur la cible → retirer
                    try:
                        await target_membre.remove_roles(
                            target_role,
                            reason=f"Resync au démarrage — rôle {source_role.name} retiré",
                        )
                        retraits += 1
                    except (discord.Forbidden, discord.HTTPException):
                        pass

        print(f"Resync terminé : {ajouts} ajout(s), {retraits} retrait(s)")

        # Logger le résumé dans les canaux d'audit des serveurs sources
        await self._log_resync(mappings, ajouts, retraits)

    async def _log_resync(self, mappings, ajouts, retraits):
        """Logue un résumé du resync au démarrage."""
        if ajouts == 0 and retraits == 0:
            return

        log_channel_name = os.getenv("LOG_CHANNEL_NAME")

        # Trouver tous les serveurs sources uniques pour y poster le log
        source_guild_ids = set(m[0] for m in mappings)
        for guild_id in source_guild_ids:
            guild = self.bot.get_guild(guild_id)
            if not guild:
                continue
            log_channel = discord.utils.get(guild.text_channels, name=log_channel_name)
            if not log_channel:
                continue

            embed = discord.Embed(
                title="Resynchronisation au démarrage",
                description="Le bot a vérifié toutes les correspondances de rôles.",
                color=discord.Color.gold(),
            )
            embed.add_field(name="Rôles ajoutés", value=str(ajouts), inline=True)
            embed.add_field(name="Rôles retirés", value=str(retraits), inline=True)

            await log_channel.send(embed=embed)

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
            return

        if target_role in target_membre.roles:
            return

        try:
            await target_membre.add_roles(
                target_role,
                reason=f"Synchronisation depuis {membre.guild.name} — rôle {source_role.name}",
            )
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
            return

        try:
            await target_membre.remove_roles(
                target_role,
                reason=f"Synchronisation depuis {membre.guild.name} — rôle {source_role.name} retiré",
            )
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
