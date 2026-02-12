const commands = require('./commands');
const listeners = require('./listeners');

module.exports = {
    name: 'sync',
    description: 'Synchronisation de rôles multi-serveurs',

    commands,

    listeners: {
        guildMemberUpdate: listeners.onMemberUpdate,
        guildMemberAdd: listeners.onMemberJoin,
    },

    onReady: async (client, context) => {
        await listeners.resyncOnReady(client, context.db);
        listeners.startExpirationChecker(client, context.db);
    },
};
