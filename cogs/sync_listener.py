import asyncio
import time
import discord
from discord.ext import commands, tasks
import aiosqlite
import os

from cogs.utils import formater_duree, avec_retry

DB_PATH = os.getenv("DB_PATH")

# Délai entre chaque appel API Discord au resync (en secondes)
# Évite le rate limit de Discord (~50 requêtes/seconde)
RESYNC_DELAI = 0.5


class SyncListener(commands.Cog):
    """Écoute les changements de rôles sur le serveur racine et synchronise
    automatiquement les rôles correspondants sur les serveurs cibles.
    Au démarrage du bot, effectue un resync complet avec rate limiting.
    Vérifie périodiquement les rôles expirés et les retire automatiquement."""

    def __init__(self, bot):
        self.bot = bot

    def cog_unload(self):
        self.verifier_expirations.cancel()

    # ──────────────────────────────────────────────
    # Tâche de fond : vérifier les rôles expirés
    # ──────────────────────────────────────────────

    @tasks.loop(minutes=1)
    async def verifier_expirations(self):
        """Vérifie toutes les minutes si des rôles synchronisés ont expiré."""
        maintenant = time.time()

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                """SELECT a.member_id, a.source_guild_id, a.source_role_id,
                          a.target_guild_id, a.target_role_id, a.synced_at,
                          s.duree_minutes, s.note
                   FROM role_sync_actif a
                   JOIN role_sync s ON a.source_guild_id = s.source_guild_id
                       AND a.source_role_id = s.source_role_id
                       AND a.target_guild_id = s.target_guild_id
                       AND a.target_role_id = s.target_role_id
                   WHERE s.duree_minutes IS NOT NULL"""
            ) as cursor:
                rows = await cursor.fetchall()

        for member_id, source_guild_id, source_role_id, target_guild_id, target_role_id, synced_at, duree_minutes, note in rows:
            expire_at = synced_at + (duree_minutes * 60)
            if maintenant < expire_at:
                continue

            target_guild = self.bot.get_guild(target_guild_id)
            if not target_guild:
                continue
            target_role = target_guild.get_role(target_role_id)
            if not target_role:
                continue
            target_membre = target_guild.get_member(member_id)
            if not target_membre:
                continue

            source_guild = self.bot.get_guild(source_guild_id)
            source_role = source_guild.get_role(source_role_id) if source_guild else None

            if target_role in target_membre.roles:
                try:
                    await avec_retry(
                        target_membre.remove_roles,
                        target_role,
                        reason=f"Durée expirée — rôle synchronisé depuis {formater_duree(duree_minutes)}",
                    )
                    await self._log_sync(
                        "Expiration de rôle — durée écoulée",
                        target_membre, source_role, target_role, target_guild,
                        source_guild=source_guild, note=note,
                    )
                except (discord.Forbidden, discord.HTTPException):
                    pass

            # Supprimer l'entrée active
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    """DELETE FROM role_sync_actif
                       WHERE member_id = ? AND source_guild_id = ? AND source_role_id = ?
                       AND target_guild_id = ? AND target_role_id = ?""",
                    (member_id, source_guild_id, source_role_id, target_guild_id, target_role_id),
                )
                await db.commit()

    @verifier_expirations.before_loop
    async def avant_verifier_expirations(self):
        await self.bot.wait_until_ready()

    # ──────────────────────────────────────────────
    # Resync au démarrage (avec rate limiting)
    # ──────────────────────────────────────────────

    @commands.Cog.listener()
    async def on_ready(self):
        """Resynchronisation complète au démarrage du bot avec rate limiting."""
        print("Resynchronisation des rôles au démarrage...")

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note FROM role_sync"
            ) as cursor:
                mappings = await cursor.fetchall()

        ajouts = 0
        retraits = 0

        for source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note in mappings:
            source_guild = self.bot.get_guild(source_guild_id)
            target_guild = self.bot.get_guild(target_guild_id)
            if not source_guild or not target_guild:
                continue

            source_role = source_guild.get_role(source_role_id)
            target_role = target_guild.get_role(target_role_id)
            if not source_role or not target_role:
                continue

            for membre in source_guild.members:
                target_membre = target_guild.get_member(membre.id)
                if not target_membre:
                    continue

                a_le_role_source = source_role in membre.roles
                a_le_role_cible = target_role in target_membre.roles

                if a_le_role_source and not a_le_role_cible:
                    try:
                        await target_membre.add_roles(
                            target_role,
                            reason=f"Resync au démarrage — rôle {source_role.name}",
                        )
                        if duree_minutes:
                            await self._enregistrer_sync_actif(
                                membre.id, source_guild_id, source_role_id,
                                target_guild_id, target_role_id,
                            )
                        ajouts += 1
                        await self._log_sync(
                            "Ajout au resync (démarrage)",
                            membre, source_role, target_role, target_guild,
                            source_guild=source_guild, note=note,
                        )
                    except (discord.Forbidden, discord.HTTPException):
                        await self._log_sync(
                            "Échec ajout au resync (démarrage)",
                            membre, source_role, target_role, target_guild,
                            source_guild=source_guild, note=note,
                        )
                    # Rate limit : attendre entre chaque appel API
                    await asyncio.sleep(RESYNC_DELAI)

                elif not a_le_role_source and a_le_role_cible:
                    try:
                        await target_membre.remove_roles(
                            target_role,
                            reason=f"Resync au démarrage — rôle {source_role.name} retiré",
                        )
                        await self._supprimer_sync_actif(
                            membre.id, source_guild_id, source_role_id,
                            target_guild_id, target_role_id,
                        )
                        retraits += 1
                        await self._log_sync(
                            "Retrait au resync (démarrage)",
                            membre, source_role, target_role, target_guild,
                            source_guild=source_guild, note=note,
                        )
                    except (discord.Forbidden, discord.HTTPException):
                        await self._log_sync(
                            "Échec retrait au resync (démarrage)",
                            membre, source_role, target_role, target_guild,
                            source_guild=source_guild, note=note,
                        )
                    # Rate limit : attendre entre chaque appel API
                    await asyncio.sleep(RESYNC_DELAI)

        print(f"Resync terminé : {ajouts} ajout(s), {retraits} retrait(s)")

        # Lancer la tâche de vérification des expirations
        if not self.verifier_expirations.is_running():
            self.verifier_expirations.start()

    # ──────────────────────────────────────────────
    # Écoute des changements de rôles en temps réel
    # ──────────────────────────────────────────────

    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        roles_avant = set(before.roles)
        roles_apres = set(after.roles)

        roles_ajoutes = roles_apres - roles_avant
        roles_retires = roles_avant - roles_apres

        if not roles_ajoutes and not roles_retires:
            return

        source_guild = after.guild

        async with aiosqlite.connect(DB_PATH) as db:
            for role in roles_ajoutes:
                async with db.execute(
                    """SELECT target_guild_id, target_role_id, duree_minutes, note FROM role_sync
                       WHERE source_guild_id = ? AND source_role_id = ?""",
                    (source_guild.id, role.id),
                ) as cursor:
                    rows = await cursor.fetchall()

                for target_guild_id, target_role_id, duree_minutes, note in rows:
                    await self._ajouter_role(after, role, target_guild_id, target_role_id, duree_minutes, note)

            for role in roles_retires:
                async with db.execute(
                    """SELECT target_guild_id, target_role_id, duree_minutes, note FROM role_sync
                       WHERE source_guild_id = ? AND source_role_id = ?""",
                    (source_guild.id, role.id),
                ) as cursor:
                    rows = await cursor.fetchall()

                for target_guild_id, target_role_id, duree_minutes, note in rows:
                    await self._retirer_role(after, role, target_guild_id, target_role_id, note)

    # ──────────────────────────────────────────────
    # Méthodes internes
    # ──────────────────────────────────────────────

    async def _ajouter_role(self, membre, source_role, target_guild_id, target_role_id, duree_minutes, note):
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
            await avec_retry(
                target_membre.add_roles,
                target_role,
                reason=f"Synchronisation depuis {membre.guild.name} — rôle {source_role.name}",
            )
            if duree_minutes:
                await self._enregistrer_sync_actif(
                    membre.id, membre.guild.id, source_role.id,
                    target_guild_id, target_role_id,
                )
            await self._log_sync(
                "Ajout automatique de rôle",
                membre, source_role, target_role, target_guild,
                source_guild=membre.guild, note=note, duree_minutes=duree_minutes,
            )
        except discord.Forbidden:
            await self._log_sync(
                "Échec — permissions insuffisantes pour ajouter le rôle",
                membre, source_role, target_role, target_guild,
                source_guild=membre.guild, note=note,
            )
        except discord.HTTPException:
            await self._log_sync(
                "Échec — erreur lors de l'ajout du rôle (après retry)",
                membre, source_role, target_role, target_guild,
                source_guild=membre.guild, note=note,
            )

    async def _retirer_role(self, membre, source_role, target_guild_id, target_role_id, note):
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
            await avec_retry(
                target_membre.remove_roles,
                target_role,
                reason=f"Synchronisation depuis {membre.guild.name} — rôle {source_role.name} retiré",
            )
            await self._supprimer_sync_actif(
                membre.id, membre.guild.id, source_role.id,
                target_guild_id, target_role_id,
            )
            await self._log_sync(
                "Retrait automatique de rôle",
                membre, source_role, target_role, target_guild,
                source_guild=membre.guild, note=note,
            )
        except discord.Forbidden:
            await self._log_sync(
                "Échec — permissions insuffisantes pour retirer le rôle",
                membre, source_role, target_role, target_guild,
                source_guild=membre.guild, note=note,
            )
        except discord.HTTPException:
            await self._log_sync(
                "Échec — erreur lors du retrait du rôle (après retry)",
                membre, source_role, target_role, target_guild,
                source_guild=membre.guild, note=note,
            )

    async def _enregistrer_sync_actif(self, member_id, source_guild_id, source_role_id, target_guild_id, target_role_id):
        """Enregistre un sync actif avec le timestamp pour le suivi de durée."""
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT OR REPLACE INTO role_sync_actif
                   (member_id, source_guild_id, source_role_id, target_guild_id, target_role_id, synced_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (member_id, source_guild_id, source_role_id, target_guild_id, target_role_id, time.time()),
            )
            await db.commit()

    async def _supprimer_sync_actif(self, member_id, source_guild_id, source_role_id, target_guild_id, target_role_id):
        """Supprime un sync actif."""
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """DELETE FROM role_sync_actif
                   WHERE member_id = ? AND source_guild_id = ? AND source_role_id = ?
                   AND target_guild_id = ? AND target_role_id = ?""",
                (member_id, source_guild_id, source_role_id, target_guild_id, target_role_id),
            )
            await db.commit()

    async def _log_sync(self, action, membre, source_role, target_role, target_guild, source_guild=None, note=None, duree_minutes=None):
        """Envoie un log d'audit détaillé pour chaque action de synchronisation."""
        log_channel_name = os.getenv("LOG_CHANNEL_NAME")
        guild_pour_log = source_guild or membre.guild
        log_channel = discord.utils.get(guild_pour_log.text_channels, name=log_channel_name)
        if not log_channel:
            return

        if "Échec" in action:
            couleur = discord.Color.red()
        elif "Retrait" in action or "Expiration" in action:
            couleur = discord.Color.dark_orange()
        else:
            couleur = discord.Color.green()

        embed = discord.Embed(
            title="Synchronisation automatique",
            description=action,
            color=couleur,
        )
        embed.add_field(name="Membre", value=membre.mention, inline=False)
        if source_role:
            embed.add_field(name="Rôle Source", value=f"{source_role.name} (ID: {source_role.id})", inline=True)
        embed.add_field(name="Rôle Cible", value=f"{target_role.name} (ID: {target_role.id})", inline=True)
        embed.add_field(name="Serveur Cible", value=f"{target_guild.name}", inline=True)
        if duree_minutes:
            embed.add_field(name="Durée", value=formater_duree(duree_minutes), inline=True)
        if note:
            embed.add_field(name="Note", value=note, inline=False)

        await log_channel.send(embed=embed)


async def setup(bot):
    await bot.add_cog(SyncListener(bot))
