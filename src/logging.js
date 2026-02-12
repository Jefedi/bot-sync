const { EmbedBuilder } = require('discord.js');

const LOG_CHANNEL_NAME = process.env.LOG_CHANNEL_NAME || 'logs-sync';

/**
 * Envoie un log d'audit pour une commande utilisateur.
 */
async function logAction(guild, action, user, sourceRole = null, targetRole = null, targetGuildId = null) {
    const logChannel = guild.channels.cache.find(
        ch => ch.name === LOG_CHANNEL_NAME && ch.isTextBased()
    );
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setTitle("Journalisation d'une action")
        .setDescription(`${action} a été effectuée.`)
        .setColor(0x57F287) // Vert
        .addFields({ name: 'Utilisateur', value: `${user}`, inline: false });

    if (sourceRole) {
        embed.addFields({ name: 'Rôle Source', value: `${sourceRole}`, inline: true });
    }
    if (targetRole) {
        embed.addFields({ name: 'Rôle Cible', value: `${targetRole}`, inline: true });
    }
    if (targetGuildId) {
        embed.addFields({ name: 'Serveur Cible', value: `ID : ${targetGuildId}`, inline: true });
    }

    await logChannel.send({ embeds: [embed] }).catch(() => {});
}

/**
 * Envoie un log d'audit détaillé pour une action de synchronisation automatique.
 */
async function logSync(client, action, member, sourceRole, targetRole, targetGuild, options = {}) {
    const { sourceGuild = null, note = null, dureeMinutes = null } = options;
    const { formaterDuree } = require('./utils');

    const guildPourLog = sourceGuild || member.guild;
    const logChannel = guildPourLog.channels.cache.find(
        ch => ch.name === LOG_CHANNEL_NAME && ch.isTextBased()
    );
    if (!logChannel) return;

    let couleur;
    if (action.includes('Échec')) {
        couleur = 0xED4245; // Rouge
    } else if (action.includes('Retrait') || action.includes('Expiration')) {
        couleur = 0xE67E22; // Orange
    } else {
        couleur = 0x57F287; // Vert
    }

    const embed = new EmbedBuilder()
        .setTitle('Synchronisation automatique')
        .setDescription(action)
        .setColor(couleur)
        .addFields({ name: 'Membre', value: `${member}`, inline: false });

    if (sourceRole) {
        embed.addFields({ name: 'Rôle Source', value: `${sourceRole.name} (ID: ${sourceRole.id})`, inline: true });
    }
    if (targetRole) {
        embed.addFields({ name: 'Rôle Cible', value: `${targetRole.name} (ID: ${targetRole.id})`, inline: true });
    }
    if (targetGuild) {
        embed.addFields({ name: 'Serveur Cible', value: `${targetGuild.name}`, inline: true });
    }
    if (dureeMinutes) {
        embed.addFields({ name: 'Durée', value: formaterDuree(dureeMinutes), inline: true });
    }
    if (note) {
        embed.addFields({ name: 'Note', value: note, inline: false });
    }

    await logChannel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { logAction, logSync };
