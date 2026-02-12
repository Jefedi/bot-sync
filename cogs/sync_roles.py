import json
import discord
from discord import app_commands
from discord.ext import commands
import aiosqlite
import os

from cogs.utils import parser_duree, formater_duree

DB_PATH = os.getenv("DB_PATH")

# Cooldown : 5 secondes entre chaque commande de modification par utilisateur
COOLDOWN_MODIFICATION = app_commands.checks.cooldown(1, 5.0)


# ──────────────────────────────────────────────
# Fonctions d'autocomplete
# ──────────────────────────────────────────────

async def autocomplete_serveur(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    """Autocomplete : liste les serveurs où le bot est présent (sauf le serveur actuel)."""
    choix = []
    for guild in interaction.client.guilds:
        if guild.id == interaction.guild_id:
            continue
        nom = f"{guild.name} ({guild.id})"
        if current.lower() in nom.lower() or current in str(guild.id):
            choix.append(app_commands.Choice(name=nom[:100], value=str(guild.id)))
        if len(choix) >= 25:
            break
    return choix


async def autocomplete_role_cible(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    """Autocomplete : liste les rôles du serveur cible sélectionné."""
    # Récupérer le target_guild_id déjà saisi par l'utilisateur
    guild_id_str = interaction.namespace.target_guild_id
    if not guild_id_str:
        return []
    try:
        guild_id = int(guild_id_str)
    except ValueError:
        return []

    target_guild = interaction.client.get_guild(guild_id)
    if not target_guild:
        return []

    choix = []
    for role in target_guild.roles:
        if role.is_default():
            continue
        nom = f"{role.name} ({role.id})"
        if current.lower() in nom.lower() or current in str(role.id):
            choix.append(app_commands.Choice(name=nom[:100], value=str(role.id)))
        if len(choix) >= 25:
            break
    return choix


class SyncRoles(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    def _get_logging_cog(self):
        """Récupère le cog Logging de manière sécurisée."""
        return self.bot.get_cog("Logging")

    async def _log(self, action, interaction, source_role=None, target_role=None, target_guild_id=None):
        """Appelle le cog Logging s'il est disponible."""
        cog = self._get_logging_cog()
        if cog:
            await cog.log_action(action, interaction, source_role, target_role, target_guild_id)

    # ──────────────────────────────────────────────
    # /aide — Affiche l'aide du bot
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="aide",
        description="Affiche l'aide complète du bot de synchronisation de rôles.",
    )
    async def aide(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="Bot Sync — Aide",
            description="Bot de synchronisation de rôles entre serveurs Discord.",
            color=discord.Color.blurple(),
        )

        embed.add_field(
            name="Configuration",
            value=(
                "`/ajouter_sync_role` — Créer une correspondance de rôles\n"
                "`/supprimer_sync_role` — Supprimer une correspondance\n"
                "`/voir_sync_roles` — Voir toutes les correspondances du serveur\n"
                "`/copier_sync` — Copier les configs d'un serveur cible vers un autre"
            ),
            inline=False,
        )
        embed.add_field(
            name="Gestion",
            value=(
                "`/resync @membre` — Resynchroniser les rôles d'un membre\n"
                "`/nettoyer_sync` — Supprimer les syncs orphelines\n"
                "`/bot_status` — Dashboard du bot (état, stats, permissions)"
            ),
            inline=False,
        )
        embed.add_field(
            name="Import / Export",
            value=(
                "`/exporter_config` — Exporter la config en JSON\n"
                "`/importer_config` — Importer une config depuis du JSON"
            ),
            inline=False,
        )
        embed.add_field(
            name="Format des durées",
            value=(
                "`30m` = 30 minutes\n"
                "`12h` = 12 heures\n"
                "`7j` = 7 jours\n"
                "`1j12h` = 1 jour et 12 heures\n"
                "Sans durée = permanent (jusqu'au retrait manuel)\n"
                "Maximum : `365j`"
            ),
            inline=False,
        )
        embed.add_field(
            name="Fonctionnement",
            value=(
                "1. Configurez les correspondances depuis le **serveur racine**\n"
                "2. Quand un rôle est **ajouté/retiré** sur le serveur racine, "
                "le rôle correspondant est automatiquement synchronisé sur le serveur cible\n"
                "3. Au **démarrage** du bot, tous les rôles sont vérifiés et mis à jour\n"
                "4. Les rôles avec une **durée** expirent automatiquement"
            ),
            inline=False,
        )
        embed.set_footer(text="Toutes les commandes de configuration nécessitent la permission Administrateur.")

        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ──────────────────────────────────────────────
    # /bot_status — Dashboard du bot
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="bot_status",
        description="Affiche l'état du bot, les stats et les permissions sur chaque serveur.",
    )
    @app_commands.default_permissions(administrator=True)
    async def bot_status(self, interaction: discord.Interaction):
        try:
            await interaction.response.defer(ephemeral=True)

            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    "SELECT COUNT(*) FROM role_sync WHERE source_guild_id = ?",
                    (interaction.guild.id,),
                ) as cursor:
                    nb_syncs = (await cursor.fetchone())[0]

                async with db.execute(
                    "SELECT COUNT(*) FROM role_sync_actif WHERE source_guild_id = ?",
                    (interaction.guild.id,),
                ) as cursor:
                    nb_actifs = (await cursor.fetchone())[0]

                async with db.execute(
                    "SELECT DISTINCT target_guild_id FROM role_sync WHERE source_guild_id = ?",
                    (interaction.guild.id,),
                ) as cursor:
                    target_guild_ids = [row[0] for row in await cursor.fetchall()]

            embed = discord.Embed(
                title="Bot Sync — État",
                color=discord.Color.blurple(),
            )
            embed.add_field(name="Serveurs connectés", value=str(len(self.bot.guilds)), inline=True)
            embed.add_field(name="Syncs configurées", value=str(nb_syncs), inline=True)
            embed.add_field(name="Syncs actives (avec durée)", value=str(nb_actifs), inline=True)

            # Vérifier les permissions sur chaque serveur cible
            if target_guild_ids:
                lignes = []
                for guild_id in target_guild_ids:
                    guild = self.bot.get_guild(guild_id)
                    if not guild:
                        lignes.append(f"**Inconnu** (`{guild_id}`) — Serveur inaccessible")
                        continue

                    me = guild.me
                    perms = me.guild_permissions
                    peut_gerer = perms.manage_roles

                    # Vérifier la hiérarchie : le rôle le plus haut du bot
                    pos_bot = me.top_role.position

                    statut = "OK" if peut_gerer else "Pas la permission `Gérer les rôles`"
                    lignes.append(f"**{guild.name}** — {statut} (position du bot : {pos_bot})")

                embed.add_field(
                    name="Serveurs cibles",
                    value="\n".join(lignes) or "Aucun",
                    inline=False,
                )

            # Vérifier les syncs orphelines
            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    "SELECT source_role_id, target_guild_id, target_role_id FROM role_sync WHERE source_guild_id = ?",
                    (interaction.guild.id,),
                ) as cursor:
                    rows = await cursor.fetchall()

            orphelins = 0
            for source_role_id, target_guild_id, target_role_id in rows:
                source_role = interaction.guild.get_role(source_role_id)
                target_guild = self.bot.get_guild(target_guild_id)
                target_role = target_guild.get_role(target_role_id) if target_guild else None
                if not source_role or not target_guild or not target_role:
                    orphelins += 1

            if orphelins > 0:
                embed.add_field(
                    name="Syncs orphelines",
                    value=f"**{orphelins}** sync(s) avec un rôle/serveur supprimé. Utilisez `/nettoyer_sync`.",
                    inline=False,
                )

            await interaction.followup.send(embed=embed)

        except Exception as e:
            if interaction.response.is_done():
                await interaction.followup.send(f"Une erreur est survenue : {e}")
            else:
                await interaction.response.send_message(f"Une erreur est survenue : {e}", ephemeral=True)

    # ──────────────────────────────────────────────
    # /ajouter_sync_role — Avec autocomplete + vérification hiérarchie + cooldown
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="ajouter_sync_role",
        description="Synchronise un rôle du serveur racine avec un rôle d'un autre serveur.",
    )
    @app_commands.default_permissions(administrator=True)
    @COOLDOWN_MODIFICATION
    @app_commands.describe(
        source_role="Le rôle sur ce serveur (serveur racine)",
        target_guild_id="Le serveur cible (tapez pour chercher)",
        target_role_id="Le rôle sur le serveur cible (tapez pour chercher)",
        duree="Durée optionnelle (ex: 30m, 12h, 7j, 1j12h). Sans durée = permanent",
        note="Note optionnelle associée à cette synchronisation (max 200 caractères)",
    )
    @app_commands.autocomplete(target_guild_id=autocomplete_serveur, target_role_id=autocomplete_role_cible)
    async def ajouter_sync_role(
        self,
        interaction: discord.Interaction,
        source_role: discord.Role,
        target_guild_id: str,
        target_role_id: str,
        duree: str = None,
        note: str = None,
    ):
        try:
            try:
                target_guild_id_int = int(target_guild_id)
                target_role_id_int = int(target_role_id)
            except ValueError:
                await interaction.response.send_message(
                    "Les IDs doivent être des nombres valides.\n"
                    "Astuce : clic droit sur le serveur/rôle → **Copier l'identifiant**",
                    ephemeral=True,
                )
                return

            duree_minutes = None
            if duree:
                duree_minutes = parser_duree(duree)
                if duree_minutes is None:
                    await interaction.response.send_message(
                        "Format de durée invalide. Utilisez : `30m`, `12h`, `7j`, `1j12h`\n"
                        "Maximum : `365j`",
                        ephemeral=True,
                    )
                    return

            if note and len(note) > 200:
                await interaction.response.send_message(
                    "La note ne doit pas dépasser 200 caractères.", ephemeral=True
                )
                return

            target_guild = self.bot.get_guild(target_guild_id_int)
            if not target_guild:
                await interaction.response.send_message(
                    f"Le bot n'est pas présent sur le serveur avec l'ID `{target_guild_id_int}`.",
                    ephemeral=True,
                )
                return

            target_role = target_guild.get_role(target_role_id_int)
            if not target_role:
                await interaction.response.send_message(
                    f"Le rôle avec l'ID `{target_role_id_int}` n'existe pas sur **{target_guild.name}**.",
                    ephemeral=True,
                )
                return

            # Vérifier que le bot peut gérer ce rôle (hiérarchie)
            bot_membre = target_guild.me
            if not bot_membre.guild_permissions.manage_roles:
                await interaction.response.send_message(
                    f"Le bot n'a pas la permission **Gérer les rôles** sur **{target_guild.name}**.",
                    ephemeral=True,
                )
                return

            if target_role.position >= bot_membre.top_role.position:
                await interaction.response.send_message(
                    f"Le rôle **{target_role.name}** est au-dessus du rôle du bot sur **{target_guild.name}**.\n"
                    f"Déplacez le rôle du bot plus haut dans la hiérarchie.",
                    ephemeral=True,
                )
                return

            async with aiosqlite.connect(DB_PATH) as db:
                try:
                    await db.execute(
                        """INSERT INTO role_sync (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (interaction.guild.id, source_role.id, target_guild_id_int, target_role_id_int, duree_minutes, note),
                    )
                    await db.commit()
                except aiosqlite.IntegrityError:
                    await interaction.response.send_message(
                        "Cette synchronisation existe déjà.", ephemeral=True
                    )
                    return

            msg = (
                f"Synchronisation créée :\n"
                f"**{source_role.name}** (ce serveur) → **{target_role.name}** (serveur **{target_guild.name}**)"
            )
            if duree_minutes:
                msg += f"\nDurée : **{formater_duree(duree_minutes)}**"
            else:
                msg += "\nDurée : **Permanent** (jusqu'au retrait manuel)"
            if note:
                msg += f"\nNote : {note}"

            await interaction.response.send_message(msg, ephemeral=True)
            await self._log("Ajout de synchronisation", interaction, source_role, target_role, target_guild_id_int)

        except Exception as e:
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    f"Une erreur est survenue : {e}", ephemeral=True
                )

    # ──────────────────────────────────────────────
    # /supprimer_sync_role — Avec autocomplete + cooldown
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="supprimer_sync_role",
        description="Supprime une synchronisation de rôles.",
    )
    @app_commands.default_permissions(administrator=True)
    @COOLDOWN_MODIFICATION
    @app_commands.describe(
        source_role="Le rôle sur ce serveur (serveur racine)",
        target_guild_id="Le serveur cible (tapez pour chercher)",
        target_role_id="Le rôle sur le serveur cible (tapez pour chercher)",
    )
    @app_commands.autocomplete(target_guild_id=autocomplete_serveur, target_role_id=autocomplete_role_cible)
    async def supprimer_sync_role(
        self,
        interaction: discord.Interaction,
        source_role: discord.Role,
        target_guild_id: str,
        target_role_id: str,
    ):
        try:
            try:
                target_guild_id_int = int(target_guild_id)
                target_role_id_int = int(target_role_id)
            except ValueError:
                await interaction.response.send_message(
                    "Les IDs doivent être des nombres valides.\n"
                    "Astuce : clic droit sur le serveur/rôle → **Copier l'identifiant**",
                    ephemeral=True,
                )
                return

            async with aiosqlite.connect(DB_PATH) as db:
                cursor = await db.execute(
                    """DELETE FROM role_sync
                       WHERE source_guild_id = ? AND source_role_id = ?
                       AND target_guild_id = ? AND target_role_id = ?""",
                    (interaction.guild.id, source_role.id, target_guild_id_int, target_role_id_int),
                )
                await db.execute(
                    """DELETE FROM role_sync_actif
                       WHERE source_guild_id = ? AND source_role_id = ?
                       AND target_guild_id = ? AND target_role_id = ?""",
                    (interaction.guild.id, source_role.id, target_guild_id_int, target_role_id_int),
                )
                await db.commit()

                if cursor.rowcount == 0:
                    await interaction.response.send_message(
                        "Aucune synchronisation correspondante trouvée.", ephemeral=True
                    )
                    return

            target_guild = self.bot.get_guild(target_guild_id_int)
            target_guild_name = target_guild.name if target_guild else f"ID {target_guild_id_int}"
            target_role_obj = target_guild.get_role(target_role_id_int) if target_guild else None
            target_role_name = target_role_obj.name if target_role_obj else f"ID {target_role_id_int}"

            await interaction.response.send_message(
                f"Synchronisation supprimée :\n"
                f"**{source_role.name}** ↛ **{target_role_name}** (serveur **{target_guild_name}**)",
                ephemeral=True,
            )
            await self._log("Suppression de synchronisation", interaction, source_role, target_role_obj, target_guild_id_int)

        except Exception as e:
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    f"Une erreur est survenue : {e}", ephemeral=True
                )

    # ──────────────────────────────────────────────
    # /voir_sync_roles — Filtrée par serveur actuel
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="voir_sync_roles",
        description="Affiche les synchronisations de rôles configurées sur ce serveur.",
    )
    @app_commands.default_permissions(administrator=True)
    async def voir_sync_roles(self, interaction: discord.Interaction):
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    """SELECT source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note
                       FROM role_sync WHERE source_guild_id = ?""",
                    (interaction.guild.id,),
                ) as cursor:
                    rows = await cursor.fetchall()

            if not rows:
                await interaction.response.send_message(
                    "Aucune synchronisation configurée sur ce serveur.", ephemeral=False
                )
                return

            embed = discord.Embed(
                title="Synchronisations de rôles",
                description=f"{len(rows)} correspondance(s) sur **{interaction.guild.name}**",
                color=discord.Color.blue(),
            )

            for i, (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note) in enumerate(rows, 1):
                source_role = interaction.guild.get_role(source_role_id)
                source_role_name = source_role.name if source_role else f"Supprimé ({source_role_id})"

                target_guild = self.bot.get_guild(target_guild_id)
                target_guild_name = target_guild.name if target_guild else f"Inconnu ({target_guild_id})"
                target_role = target_guild.get_role(target_role_id) if target_guild else None
                target_role_name = target_role.name if target_role else f"Supprimé ({target_role_id})"

                valeur = (
                    f"**{source_role_name}**\n"
                    f"→ **{target_role_name}** ({target_guild_name})"
                )
                if duree_minutes:
                    valeur += f"\nDurée : {formater_duree(duree_minutes)}"
                else:
                    valeur += "\nDurée : Permanent"
                if note:
                    valeur += f"\nNote : _{note}_"

                embed.add_field(name=f"#{i}", value=valeur, inline=False)

            await interaction.response.send_message(embed=embed)

        except Exception as e:
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    f"Une erreur est survenue : {e}", ephemeral=True
                )

    # ──────────────────────────────────────────────
    # /resync — Avec embed détaillé par serveur
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="resync",
        description="Force la resynchronisation des rôles d'un membre sur tous les serveurs cibles.",
    )
    @app_commands.default_permissions(administrator=True)
    @app_commands.describe(
        membre="Le membre dont on veut resynchroniser les rôles",
    )
    async def resync(self, interaction: discord.Interaction, membre: discord.Member):
        try:
            await interaction.response.defer(ephemeral=True)

            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    """SELECT source_role_id, target_guild_id, target_role_id, duree_minutes, note
                       FROM role_sync WHERE source_guild_id = ?""",
                    (interaction.guild.id,),
                ) as cursor:
                    mappings = await cursor.fetchall()

            if not mappings:
                await interaction.followup.send("Aucune synchronisation configurée sur ce serveur.")
                return

            # Regrouper les résultats par serveur cible
            resultats_par_serveur = {}

            for source_role_id, target_guild_id, target_role_id, duree_minutes, note in mappings:
                source_role = interaction.guild.get_role(source_role_id)
                if not source_role:
                    continue

                target_guild = self.bot.get_guild(target_guild_id)
                if not target_guild:
                    nom_serveur = f"Inconnu ({target_guild_id})"
                    if nom_serveur not in resultats_par_serveur:
                        resultats_par_serveur[nom_serveur] = {"ajouts": [], "retraits": [], "erreurs": []}
                    resultats_par_serveur[nom_serveur]["erreurs"].append(f"{source_role.name} → Serveur inaccessible")
                    continue

                nom_serveur = target_guild.name
                if nom_serveur not in resultats_par_serveur:
                    resultats_par_serveur[nom_serveur] = {"ajouts": [], "retraits": [], "erreurs": []}

                target_role = target_guild.get_role(target_role_id)
                if not target_role:
                    resultats_par_serveur[nom_serveur]["erreurs"].append(f"{source_role.name} → Rôle supprimé")
                    continue

                target_membre = target_guild.get_member(membre.id)
                if not target_membre:
                    resultats_par_serveur[nom_serveur]["erreurs"].append(f"{source_role.name} → Membre absent du serveur")
                    continue

                a_le_role_source = source_role in membre.roles
                a_le_role_cible = target_role in target_membre.roles

                try:
                    if a_le_role_source and not a_le_role_cible:
                        await target_membre.add_roles(target_role, reason=f"Resync manuelle par {interaction.user}")
                        resultats_par_serveur[nom_serveur]["ajouts"].append(f"{source_role.name} → {target_role.name}")
                    elif not a_le_role_source and a_le_role_cible:
                        await target_membre.remove_roles(target_role, reason=f"Resync manuelle par {interaction.user}")
                        resultats_par_serveur[nom_serveur]["retraits"].append(f"{source_role.name} → {target_role.name}")
                except discord.Forbidden:
                    resultats_par_serveur[nom_serveur]["erreurs"].append(f"{source_role.name} → Permissions insuffisantes")
                except discord.HTTPException as e:
                    resultats_par_serveur[nom_serveur]["erreurs"].append(f"{source_role.name} → Erreur HTTP ({e.status})")

            # Construire l'embed détaillé
            embed = discord.Embed(
                title=f"Resync de {membre.display_name}",
                color=discord.Color.blue(),
            )

            for serveur, res in resultats_par_serveur.items():
                lignes = []
                for a in res["ajouts"]:
                    lignes.append(f"+ {a}")
                for r in res["retraits"]:
                    lignes.append(f"- {r}")
                for e in res["erreurs"]:
                    lignes.append(f"! {e}")

                if lignes:
                    embed.add_field(
                        name=serveur,
                        value="\n".join(lignes)[:1024],
                        inline=False,
                    )

            if not resultats_par_serveur:
                embed.description = "Aucune action nécessaire — tous les rôles sont déjà synchronisés."

            total_ajouts = sum(len(r["ajouts"]) for r in resultats_par_serveur.values())
            total_retraits = sum(len(r["retraits"]) for r in resultats_par_serveur.values())
            total_erreurs = sum(len(r["erreurs"]) for r in resultats_par_serveur.values())
            embed.set_footer(text=f"{total_ajouts} ajout(s), {total_retraits} retrait(s), {total_erreurs} erreur(s)")

            await interaction.followup.send(embed=embed)
            await self._log("Resync manuelle", interaction)

        except Exception as e:
            if interaction.response.is_done():
                await interaction.followup.send(f"Une erreur est survenue : {e}")
            else:
                await interaction.response.send_message(f"Une erreur est survenue : {e}", ephemeral=True)

    # ──────────────────────────────────────────────
    # /nettoyer_sync — Nettoyage orphelins
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="nettoyer_sync",
        description="Supprime les synchronisations dont le rôle ou le serveur n'existe plus.",
    )
    @app_commands.default_permissions(administrator=True)
    async def nettoyer_sync(self, interaction: discord.Interaction):
        try:
            await interaction.response.defer(ephemeral=True)

            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    """SELECT rowid, source_guild_id, source_role_id, target_guild_id, target_role_id
                       FROM role_sync WHERE source_guild_id = ?""",
                    (interaction.guild.id,),
                ) as cursor:
                    rows = await cursor.fetchall()

            orphelins = []
            for rowid, source_guild_id, source_role_id, target_guild_id, target_role_id in rows:
                source_role = interaction.guild.get_role(source_role_id)
                target_guild = self.bot.get_guild(target_guild_id)
                target_role = target_guild.get_role(target_role_id) if target_guild else None
                if not source_role or not target_guild or not target_role:
                    orphelins.append(rowid)

            if not orphelins:
                await interaction.followup.send("Aucune synchronisation orpheline trouvée. Tout est propre.")
                return

            async with aiosqlite.connect(DB_PATH) as db:
                for rowid in orphelins:
                    await db.execute("DELETE FROM role_sync WHERE rowid = ?", (rowid,))
                await db.commit()

            await interaction.followup.send(
                f"**{len(orphelins)}** synchronisation(s) orpheline(s) supprimée(s) "
                f"(rôle ou serveur supprimé)."
            )
            await self._log("Nettoyage des synchronisations orphelines", interaction)

        except Exception as e:
            if interaction.response.is_done():
                await interaction.followup.send(f"Une erreur est survenue : {e}")
            else:
                await interaction.response.send_message(f"Une erreur est survenue : {e}", ephemeral=True)

    # ──────────────────────────────────────────────
    # /copier_sync — Copier les syncs vers un autre serveur
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="copier_sync",
        description="Copie toutes les syncs d'un serveur cible vers un autre serveur.",
    )
    @app_commands.default_permissions(administrator=True)
    @COOLDOWN_MODIFICATION
    @app_commands.describe(
        serveur_source="Le serveur cible dont on copie les configs (tapez pour chercher)",
        serveur_destination="Le serveur cible vers lequel copier (tapez pour chercher)",
    )
    @app_commands.autocomplete(serveur_source=autocomplete_serveur, serveur_destination=autocomplete_serveur)
    async def copier_sync(
        self,
        interaction: discord.Interaction,
        serveur_source: str,
        serveur_destination: str,
    ):
        try:
            try:
                source_id = int(serveur_source)
                dest_id = int(serveur_destination)
            except ValueError:
                await interaction.response.send_message(
                    "Les IDs doivent être des nombres valides.", ephemeral=True
                )
                return

            if source_id == dest_id:
                await interaction.response.send_message(
                    "Le serveur source et destination doivent être différents.", ephemeral=True
                )
                return

            dest_guild = self.bot.get_guild(dest_id)
            if not dest_guild:
                await interaction.response.send_message(
                    f"Le bot n'est pas présent sur le serveur destination `{dest_id}`.", ephemeral=True
                )
                return

            await interaction.response.defer(ephemeral=True)

            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    """SELECT source_role_id, target_role_id, duree_minutes, note
                       FROM role_sync
                       WHERE source_guild_id = ? AND target_guild_id = ?""",
                    (interaction.guild.id, source_id),
                ) as cursor:
                    syncs = await cursor.fetchall()

            if not syncs:
                await interaction.followup.send("Aucune synchronisation trouvée pour ce serveur source.")
                return

            copies = 0
            existantes = 0
            async with aiosqlite.connect(DB_PATH) as db:
                for source_role_id, _, duree_minutes, note in syncs:
                    try:
                        await db.execute(
                            """INSERT INTO role_sync (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note)
                               VALUES (?, ?, ?, ?, ?, ?)""",
                            (interaction.guild.id, source_role_id, dest_id, 0, duree_minutes, note),
                        )
                        copies += 1
                    except aiosqlite.IntegrityError:
                        existantes += 1
                await db.commit()

            source_guild = self.bot.get_guild(source_id)
            source_name = source_guild.name if source_guild else f"ID {source_id}"

            msg = (
                f"Copie depuis **{source_name}** vers **{dest_guild.name}** :\n"
                f"**{copies}** sync(s) copiée(s)"
            )
            if existantes > 0:
                msg += f", **{existantes}** déjà existante(s)"
            msg += (
                "\n\n**Attention :** les rôles cibles sont à `0` (non configurés). "
                "Utilisez `/supprimer_sync_role` puis `/ajouter_sync_role` pour les mettre à jour "
                "avec les bons rôles du serveur destination."
            )

            await interaction.followup.send(msg)
            await self._log("Copie de synchronisations", interaction)

        except Exception as e:
            if interaction.response.is_done():
                await interaction.followup.send(f"Une erreur est survenue : {e}")
            else:
                await interaction.response.send_message(f"Une erreur est survenue : {e}", ephemeral=True)

    # ──────────────────────────────────────────────
    # /exporter_config — Export JSON
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="exporter_config",
        description="Exporte la configuration de synchronisation en JSON.",
    )
    @app_commands.default_permissions(administrator=True)
    async def exporter_config(self, interaction: discord.Interaction):
        try:
            await interaction.response.defer(ephemeral=True)

            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    """SELECT source_role_id, target_guild_id, target_role_id, duree_minutes, note
                       FROM role_sync WHERE source_guild_id = ?""",
                    (interaction.guild.id,),
                ) as cursor:
                    rows = await cursor.fetchall()

            if not rows:
                await interaction.followup.send("Aucune synchronisation à exporter.")
                return

            config = {
                "source_guild_id": interaction.guild.id,
                "source_guild_name": interaction.guild.name,
                "syncs": [],
            }
            for source_role_id, target_guild_id, target_role_id, duree_minutes, note in rows:
                source_role = interaction.guild.get_role(source_role_id)
                target_guild = self.bot.get_guild(target_guild_id)
                target_role = target_guild.get_role(target_role_id) if target_guild else None

                config["syncs"].append({
                    "source_role_id": source_role_id,
                    "source_role_name": source_role.name if source_role else None,
                    "target_guild_id": target_guild_id,
                    "target_guild_name": target_guild.name if target_guild else None,
                    "target_role_id": target_role_id,
                    "target_role_name": target_role.name if target_role else None,
                    "duree_minutes": duree_minutes,
                    "note": note,
                })

            json_str = json.dumps(config, indent=2, ensure_ascii=False)
            fichier = discord.File(
                fp=__import__("io").BytesIO(json_str.encode("utf-8")),
                filename=f"sync_config_{interaction.guild.id}.json",
            )

            await interaction.followup.send(
                f"Configuration exportée : **{len(rows)}** sync(s).",
                file=fichier,
            )

        except Exception as e:
            if interaction.response.is_done():
                await interaction.followup.send(f"Une erreur est survenue : {e}")
            else:
                await interaction.response.send_message(f"Une erreur est survenue : {e}", ephemeral=True)

    # ──────────────────────────────────────────────
    # /importer_config — Import JSON
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="importer_config",
        description="Importe une configuration de synchronisation depuis un fichier JSON.",
    )
    @app_commands.default_permissions(administrator=True)
    @COOLDOWN_MODIFICATION
    @app_commands.describe(
        fichier="Le fichier JSON exporté avec /exporter_config",
    )
    async def importer_config(self, interaction: discord.Interaction, fichier: discord.Attachment):
        try:
            if not fichier.filename.endswith(".json"):
                await interaction.response.send_message(
                    "Le fichier doit être un fichier `.json`.", ephemeral=True
                )
                return

            if fichier.size > 100_000:
                await interaction.response.send_message(
                    "Le fichier est trop volumineux (max 100 Ko).", ephemeral=True
                )
                return

            await interaction.response.defer(ephemeral=True)

            contenu = await fichier.read()
            try:
                config = json.loads(contenu.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                await interaction.followup.send("Le fichier JSON est invalide.")
                return

            syncs = config.get("syncs", [])
            if not syncs:
                await interaction.followup.send("Aucune synchronisation trouvée dans le fichier.")
                return

            importees = 0
            existantes = 0
            async with aiosqlite.connect(DB_PATH) as db:
                for sync in syncs:
                    try:
                        await db.execute(
                            """INSERT INTO role_sync (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note)
                               VALUES (?, ?, ?, ?, ?, ?)""",
                            (
                                interaction.guild.id,
                                sync["source_role_id"],
                                sync["target_guild_id"],
                                sync["target_role_id"],
                                sync.get("duree_minutes"),
                                sync.get("note"),
                            ),
                        )
                        importees += 1
                    except (aiosqlite.IntegrityError, KeyError):
                        existantes += 1
                await db.commit()

            msg = f"Import terminé : **{importees}** sync(s) importée(s)"
            if existantes > 0:
                msg += f", **{existantes}** ignorée(s) (déjà existantes ou invalides)"

            await interaction.followup.send(msg)
            await self._log("Import de configuration", interaction)

        except Exception as e:
            if interaction.response.is_done():
                await interaction.followup.send(f"Une erreur est survenue : {e}")
            else:
                await interaction.response.send_message(f"Une erreur est survenue : {e}", ephemeral=True)


async def setup(bot):
    await bot.add_cog(SyncRoles(bot))
