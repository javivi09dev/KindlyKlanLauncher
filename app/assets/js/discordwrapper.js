const { LoggerUtil } = require('helios-core')
const logger = LoggerUtil.getLogger('DiscordWrapper')
const { Client } = require('discord-rpc-patch')
const Lang = require('./langloader')

let client
let activity
let launcherActivity

const LAUNCHER_STATES = {
    IDLE: 'idle',
    SETTINGS: 'settings',
    NEWS: 'news',
    SERVER_SELECTION: 'server_selection',
    ACCOUNT_MANAGEMENT: 'account_management'
}

exports.initRPC = function(genSettings, servSettings, initialDetails = Lang.queryJS('discord.waiting'), isGameInstance = false){
    client = new Client({ transport: 'ipc' })

    // activity: Configuración de Discord RPC de CADA instancia
    activity = {
        details: initialDetails,
        state: Lang.queryJS('discord.state', {shortId: servSettings.shortId}),
        largeImageKey: servSettings.largeImageKey,
        largeImageText: servSettings.largeImageText,
        smallImageKey: genSettings.smallImageKey,
        smallImageText: genSettings.smallImageText,
        startTimestamp: new Date().getTime(),
        instance: false
    }

    // launcherActivity: Configuración de Discord RPC cuando NO se juega a una instancia
    launcherActivity = {
        details: 'En el Launcher',
        state: 'discord.kindlyklan.com',
        largeImageKey: 'kindly-logo',
        largeImageText: 'Kindly Klan Launcher',
        smallImageKey: 'kindly-logo',
        smallImageText: 'Kindly Klan',
        startTimestamp: new Date().getTime(),
        instance: false
    }

    client.on('ready', () => {
        logger.info('Discord RPC Connected')
        // Usar activity si es una instancia de juego, 
        // sino usar launcherActivity
        client.setActivity(isGameInstance ? activity : launcherActivity)
    })
    
    client.login({clientId: genSettings.clientId}).catch(error => {
        if(error.message.includes('ENOENT')) {
            logger.info('Unable to initialize Discord Rich Presence, no client detected.')
        } else {
            logger.info('Unable to initialize Discord Rich Presence: ' + error.message, error)
        }
    })
}

exports.updateDetails = function(details){
    if (!client) return
    
    activity.details = details
    client.setActivity(activity)
}

exports.showLauncherActivity = function(state = LAUNCHER_STATES.IDLE, customDetails = null) {
    if (!client) return

    let details = 'Navegando en el launcher'
    let stateText = 'discord.kindlyklan.com'

    launcherActivity.details = details
    launcherActivity.state = stateText
    launcherActivity.startTimestamp = new Date().getTime()

    client.setActivity(launcherActivity)
}

exports.returnToLauncher = function() {
    if (!client) return
    
    logger.info('Returning to launcher Discord activity')
    client.setActivity(launcherActivity)
}

exports.shutdownRPC = function(){
    if(!client) return
    client.clearActivity()
    client.destroy()
    client = null
    activity = null
    launcherActivity = null
}

exports.LAUNCHER_STATES = LAUNCHER_STATES