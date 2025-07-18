/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')
const { proxyInstance }       = require('./assets/js/tcpproxy')
const { EnhancedDownloadManager } = require('./assets/js/downloadmanager')

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

const WHITELIST_URL = 'http://files.kindlyklan.com:26500/whitelist/whitelist.json'

const SERVER_STATUS_CONFIG_URL = 'http://files.kindlyklan.com:26500/whitelist/server.json'

const { getConfigForDownloadType } = require('./assets/js/downloadconfig')
const downloadManager = new EnhancedDownloadManager(getConfigForDownloadType('default'))
let hideServerAndMojangStatus = false

async function fetchAndApplyServerStatusConfig() {
    try {
        const timestamp = Date.now()
        const response = await fetch(`${SERVER_STATUS_CONFIG_URL}?t=${timestamp}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        })
        if (!response.ok) throw new Error('No se pudo obtener el JSON de estado')
        const data = await response.json()
        hideServerAndMojangStatus = data.serverAndMojangStatus === false
        applyServerStatusUI()
    } catch (e) {
        hideServerAndMojangStatus = false
        applyServerStatusUI()
    }
}

function applyServerStatusUI() {
    const lower = document.getElementById('lower')
    const right = lower.querySelector('#right')
    const launchContent = right.querySelector('#launch_content')
    const launchDetails = right.querySelector('#launch_details')

    if (hideServerAndMojangStatus) {
        lower.classList.add('centeredPlayMode')
        if (launchDetails && launchDetails.parentElement === launchContent) {
            right.appendChild(launchDetails)
        }
    } else {
        lower.classList.remove('centeredPlayMode')
        if (launchDetails && launchDetails.parentElement !== launchContent) {
            launchContent.appendChild(launchDetails)
        }
    }
}

async function checkWhitelist(username) {
    try {
        loggerLanding.info('Verificando whitelist para:', username)
        const timestamp = Date.now()
        const response = await fetch(`${WHITELIST_URL}?t=${timestamp}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        })
        if (!response.ok) {
            loggerLanding.error('Error al obtener la whitelist:', response.status)
            return true
        }
        
        const whitelistData = await response.json()
        
        if (whitelistData.whitelist === false) {
            loggerLanding.info('La whitelist está desactivada, permitiendo acceso')
            return true
        }
        
        if (whitelistData.allowedUsers) {
            loggerLanding.info('Formato de whitelist encontrado: allowedUsers')
            return whitelistData.allowedUsers.some(entry => 
                typeof entry === 'string' && entry.toLowerCase() === username.toLowerCase()
            )
        }
        
        if (Array.isArray(whitelistData)) {
            loggerLanding.info('Formato de whitelist encontrado: array')
            return whitelistData.some(entry => 
                typeof entry === 'string' ? 
                    entry.toLowerCase() === username.toLowerCase() : 
                    entry.name && entry.name.toLowerCase() === username.toLowerCase()
            )
        } else if (typeof whitelistData === 'object') {
            loggerLanding.info('Formato de whitelist encontrado: objeto')
            return whitelistData[username.toLowerCase()] !== undefined || 
                   Object.values(whitelistData).some(v => 
                       typeof v === 'string' ? 
                           v.toLowerCase() === username.toLowerCase() : 
                           v.name && v.name.toLowerCase() === username.toLowerCase()
                   )
        }
        
        loggerLanding.warn('Formato de whitelist no reconocido')
        return false
    } catch (err) {
        loggerLanding.error('Error al verificar whitelist:', err)
        return true
    }
}

/**
 * Actualiza el botón de lanzamiento según el estado de whitelist del usuario
 * @param {Object} authUser Objeto de usuario autenticado
 */
async function updateLaunchButtonWhitelist(authUser) {
    if (!authUser || !authUser.displayName) {
        setLaunchEnabled(false)
        return
    }
    
    const isWhitelisted = await checkWhitelist(authUser.displayName)
    
    if (!isWhitelisted) {
        loggerLanding.warn(`Usuario ${authUser.displayName} no está en la whitelist`)
        // Oculta todo el contenido principal del launcher
        $('#main').hide()
        // Muestra el bloqueador con animación
        const blocker = document.getElementById('whitelistBlocker')
        blocker.style.display = 'flex'
        setTimeout(() => blocker.setAttribute('visible', ''), 10)
        // Actualiza el mensaje y descripción
        document.querySelector('#whitelistBlockerContent h2').textContent = 'No estás en la whitelist'
        document.querySelector('#whitelistBlockerContent p').innerHTML = `Contacta con el equipo de <b>Kindly Klan</b>.<br>Estás logeado como "${authUser.displayName}".`
        document.getElementById('frameBar').style.zIndex = 10000
        document.getElementById('whitelistLogoutBtn').onclick = async () => {
            const acc = ConfigManager.getSelectedAccount()
            if(acc) {
                if(acc.type === 'microsoft') {
                    await AuthManager.removeMicrosoftAccount(acc.uuid)
    } else {
                    await AuthManager.removeMojangAccount(acc.uuid)
                }
            }
            location.reload()
        }
        return
    } else {
        loggerLanding.info('Usuario en whitelist, mostrando main y ocultando bloqueador')
        document.getElementById('whitelistBlocker').style.display = 'none'
        $('#main').show()
        const serverSelected = ConfigManager.getSelectedServer() != null
        setLaunchEnabled(serverSelected && isWhitelisted)
    }
}

function showProgressBarAnimated() {
    const lower = document.getElementById('lower')
    if (!lower.classList.contains('centeredPlayMode')) return
    const launchDetails = lower.querySelector('#launch_details')
    if (launchDetails) launchDetails.classList.add('showProgressBar')
}
function hideProgressBarAnimated() {
    const lower = document.getElementById('lower')
    if (!lower.classList.contains('centeredPlayMode')) return
    const launchDetails = lower.querySelector('#launch_details')
    if (launchDetails) launchDetails.classList.remove('showProgressBar')
}

function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
        showProgressBarAnimated()
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
        hideProgressBarAnimated()
    }
}

function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

function setLaunchPercentage(percent){
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.innerHTML = percent + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

// Agrego funciones para manejar la configuración remota de Java y registro de listener
async function fetchRemoteJavaConfig() {
    const timestamp = Date.now();
    const response = await fetch(`http://files.kindlyklan.com:26500/java/java_config.json?t=${timestamp}`, {
        cache: 'no-store',
        headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    });
    if (!response.ok) {
        throw new Error(`Error al obtener config Java remoto: ${response.status}`);
    }
    return response.json();
}

async function checkAndApplyRemoteJavaConfig(launchAfter = true) {
    // Si la pantalla de whitelist está visible, no hacer nada
    const blocker = document.getElementById('whitelistBlocker')
    if (blocker && blocker.hasAttribute('visible')) {
        return
    }
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer());
        if (!server) return;
        const remoteConf = await fetchRemoteJavaConfig();
        const remoteVersion = remoteConf.javaVersion;
        const currentExec = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer());
        let currentVersion = null;
        if (currentExec) {
            const details = await validateSelectedJvm(ensureJavaDirIsRoot(currentExec), server.effectiveJavaOptions.supported);
            if (details && details.semverStr) {
                currentVersion = parseInt(details.semverStr.split('.')[0], 10);
            }
        }
        if (currentVersion !== remoteVersion) {
            loggerLanding.info(`Java remoto ${remoteVersion} requerido, descargando/seleccionando...`);
            setOverlayContent(
                'Descargando Java...',
                'Espera unos instantes. Estamos haciendo magia por ti. Tardará unos minutos.',
                null
            );
            toggleOverlay(true, false, 'overlayContent');
            const overrideOpts = {
                suggestedMajor: remoteVersion,
                supported: [remoteVersion],
                distribution: server.effectiveJavaOptions.distribution
            };
            await downloadJava(overrideOpts, false);
            const execInput = document.getElementById('settingsJavaExecVal');
            if (execInput) {
                execInput.value = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer());
                await populateJavaExecDetails(execInput.value);
            }
            toggleOverlay(false);
            toggleLaunchArea(false);
            loggerLanding.info(`Java ${remoteVersion} aplicado según configuración remota`);
        }
    } catch (err) {
        loggerLanding.warn('No se pudo aplicar configuración Java remoto:', err);
        toggleOverlay(false);
    }
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    // Aplico configuración Java remota antes de iniciar
    await checkAndApplyRemoteJavaConfig(true);
    loggerLanding.info('Launching game..')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
    })
}

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if(authUser.uuid != null){
            document.getElementById('avatarContainer').style.backgroundImage = `url('https://mc-heads.net/avatar/${authUser.uuid}/right')`
        }
        updateLaunchButtonWhitelist(authUser)
    }
    user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    server_selection_button.innerHTML = '&#8226; ' + (serv != null ? serv.rawServer.name : Lang.queryJS('landing.noSelection'))
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
    // Aplico configuración Java remota al cambiar de instancia
    checkAndApplyRemoteJavaConfig(false);
    fetchAndApplyServerStatusConfig();
    // Reiniciar proxy TCP con nueva configuración si es necesario
    proxyInstance.restartProxy().catch(err => {
        loggerLanding.warn('Error al reiniciar proxy TCP:', err)
    });
}
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = '&#8226; ' + Lang.queryJS('landing.selectedServer.loading')
server_selection_button.onclick = async e => {
    e.target.blur()
    await toggleServerSelection(true)
}

// Update Mojang Status Color
const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')

    let status = 'grey'
    let tooltipEssentialHTML = ''
    let tooltipNonEssentialHTML = ''

    const response = await MojangRestAPI.status()
    let statuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }
    
    greenCount = 0
    greyCount = 0

    for(let i=0; i<statuses.length; i++){
        const service = statuses[i]

        const tooltipHTML = `<div class="mojangStatusContainer">
            <span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(service.status)};">&#8226;</span>
            <span class="mojangStatusName">${service.name}</span>
        </div>`
        if(service.essential){
            tooltipEssentialHTML += tooltipHTML
        } else {
            tooltipNonEssentialHTML += tooltipHTML
        }

        if(service.status === 'yellow' && status !== 'red'){
            status = 'yellow'
        } else if(service.status === 'red'){
            status = 'red'
        } else {
            if(service.status === 'grey'){
                ++greyCount
            }
            ++greenCount
        }

    }

    if(greenCount === statuses.length){
        if(greyCount === statuses.length){
            status = 'grey'
        } else {
            status = 'green'
        }
    }
    
    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
    document.getElementById('mojang_status_icon').style.color = MojangRestAPI.statusToHex(status)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')

    try {

        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        console.log(servStat)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }
    
}

refreshMojangStatuses()
// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Refresh statuses every hour. The status page itself refreshes every day so...
let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 60*60*1000)
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                //$('#overlayDismiss').toggle(false)
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        // TODO Callback hell, refactor
        if (launchAfter) {
            await dlAsync();
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    // Usar el gestor de descargas mejorado para Java
    try {
        await downloadManager.downloadWithRetry(
            asset.url, 
            asset.path, 
            ({ transferred }) => {
                setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
            }
        )
        setDownloadPercentage(100)
        
        // Validar el archivo descargado
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            loggerLanding.error(`Java download hash validation failed for ${asset.id}`)
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
        
    } catch (err) {
        loggerLanding.error('Java download failed with enhanced manager, trying fallback:', err.message)

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
                loggerLanding.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
            }
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    if (launchAfter) {
        await dlAsync();
    }
}

let proc
let hasRPC = false
let gameStartTime = null
let currentServer = null

function isMinecraftRunning() {
    return proc !== null && proc !== undefined && !proc.killed
}


const { ipcRenderer: ipc } = require('electron')
ipc.on('check-minecraft-process', () => {
    const isRunning = isMinecraftRunning()
    ipc.send('minecraft-process-status', isRunning)
})

const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000

async function dlAsync(login = true) {


    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    setLaunchDetails('Optimizando red...')
    try {
        await downloadManager.optimizeConfig()
    } catch (err) {
        loggerLaunchSuite.warn('No se pudo optimizar configuración de red:', err.message)
    }

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    
    try {
        const validationPromise = fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Validation timeout')), 120000)
        })
        
        invalidFileCount = await Promise.race([validationPromise, timeoutPromise])
        setLaunchPercentage(100)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation:', err.message)
        if (err.message === 'Validation timeout') {
            showLaunchFailure('Validación demorada', 'La validación de archivos está tomando demasiado tiempo. Inténtalo de nuevo o contacta soporte.')
        } else {
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info(`Downloading ${invalidFileCount} files with enhanced manager.`)
        setLaunchDetails(`${Lang.queryJS('landing.dlAsync.downloadingFiles')} (${invalidFileCount} archivos)`)
        setLaunchPercentage(0)
        
        try {
            try {
                await downloadManager.downloadWithRetry(
                    'test-url',
                    'test-path',
                    (progress) => setDownloadPercentage(progress.percent || 0)
                )
                loggerLaunchSuite.info('Enhanced download manager disponible')
            } catch (testErr) {
                loggerLaunchSuite.warn('Enhanced download manager no disponible, usando sistema original')
            }
            
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            setDownloadPercentage(100)
            
        } catch(err) {
            loggerLaunchSuite.error('Error during file download:', err.message)
            
            let errorMessage = Lang.queryJS('landing.dlAsync.seeConsoleForDetails')
            if (err.message.includes('timeout')) {
                errorMessage = 'La descarga se agotó el tiempo. Verifica tu conexión a internet e inténtalo de nuevo.'
            } else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
                errorMessage = 'No se pudo conectar al servidor. Verifica tu conexión a internet.'
            }
            
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), errorMessage)
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        
        loggerLaunchSuite.info(`Validando sesión de Microsoft para: ${authUser.displayName}`)
        setLaunchDetails('Validando Microsoft...')
        
        try {
            const isValidSession = await AuthManager.validateSelected()
            if (!isValidSession) {
                loggerLaunchSuite.error(`Sesión inválida para ${authUser.displayName}`)
                showLaunchFailure(
                    'Sesión no válida',
                    `Tu sesión de Microsoft ha expirado. Por favor, vuelve a iniciar sesión.`
                )
                setTimeout(() => {
                    const acc = ConfigManager.getSelectedAccount()
                    if(acc && acc.type === 'microsoft') {
                        AuthManager.removeMicrosoftAccount(acc.uuid).then(() => {
                            location.reload()
                        })
                    }
                }, 3000)
                return
            }
            loggerLaunchSuite.info('Sesión de Microsoft validada correctamente')
        } catch(err) {
            loggerLaunchSuite.error('Error al validar sesión de Microsoft:', err)
            showLaunchFailure(
                'Error de autenticación',
                'No se pudo validar tu sesión. Por favor, reinicia el launcher e intenta de nuevo.'
            )
            return
        }
        
        loggerLaunchSuite.info(`Verificando whitelist para: ${authUser.displayName}`)
        setLaunchDetails('Verificando acceso...')
        try {
            const isWhitelisted = await checkWhitelist(authUser.displayName)
            if (!isWhitelisted) {
                loggerLaunchSuite.error(`Usuario ${authUser.displayName} no está en la whitelist`)
                showLaunchFailure(
                    Lang.queryJS('landing.whitelist.notWhitelisted') || 'No estás en la whitelist',
                    Lang.queryJS('landing.whitelist.contactAdmin') || 'Contacta al administrador para solicitar acceso al servidor.'
                )
                return
            }
            
            loggerLaunchSuite.info(`Enviando cuenta seleccionada (${authUser.displayName}) a ProcessBuilder.`)
            let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())

            const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

            const onLoadComplete = () => {
                toggleLaunchArea(false)
                if(hasRPC){
                    DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                    proc.stdout.on('data', gameStateChange)
                }
                proc.stdout.removeListener('data', tempListener)
                proc.stderr.removeListener('data', gameErrorListener)
            }
            const start = Date.now()

            const tempListener = function(data){
                if(GAME_LAUNCH_REGEX.test(data.trim())){
                    const diff = Date.now()-start
                    if(diff < MIN_LINGER) {
                        setTimeout(onLoadComplete, MIN_LINGER-diff)
                    } else {
                        onLoadComplete()
                    }
                }
            }

            const gameStateChange = function(data){
                data = data.trim()
                if(SERVER_JOINED_REGEX.test(data)){
                    DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
                } else if(GAME_JOINED_REGEX.test(data)){
                    DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
                }
            }

            const gameErrorListener = function(data){
                data = data.trim()
                if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                    loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                    showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
                }
            }

            try {
                // Abrir ventana de logs antes de iniciar el proceso
                const { ipcRenderer } = require('electron')
                loggerLaunchSuite.info('Abriendo ventana de logs...')
                ipcRenderer.send('open-logs-window')
                
                // Build Minecraft process.
                proc = pb.build()
                
                currentServer = serv.rawServer.id
                gameStartTime = Date.now()

                // Bind listeners to stdout.
                proc.stdout.on('data', tempListener)
                proc.stderr.on('data', gameErrorListener)

                setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

                // Init Discord Hook
                loggerLaunchSuite.info('=== VERIFICANDO DISCORD RPC ===')
                loggerLaunchSuite.info('distro.rawDistribution.discord:', distro.rawDistribution.discord)
                loggerLaunchSuite.info('serv.rawServer.discord:', serv.rawServer.discord)
                
                if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                    loggerLaunchSuite.info('INICIANDO Discord RPC...')
                    DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                    hasRPC = true
                    proc.on('close', (code, signal) => {
                        loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                        DiscordWrapper.shutdownRPC()
                        hasRPC = false
                        
                        // Calcular y guardar tiempo de juego cuando se cierra el proceso
                        if(gameStartTime != null && currentServer != null) {
                            const now = Date.now()
                            const playedMinutes = Math.floor((now - gameStartTime) / 60000) // Convertir ms a minutos
                            loggerLaunchSuite.info(`Añadiendo ${playedMinutes} minutos de tiempo de juego a ${currentServer}`)
                            ConfigManager.addPlayTime(currentServer, playedMinutes)
                            ConfigManager.save()
                            gameStartTime = null
                            currentServer = null
                        }
                        
                        proc = null
                        loggerLaunchSuite.info('Proceso de Minecraft terminado, referencia limpiada')
                    })
                } else {
                    loggerLaunchSuite.warn('=== DISCORD RPC NO INICIADO ===')
                    loggerLaunchSuite.warn('Razón: distro.discord o server.discord es null')
                    
                    loggerLaunchSuite.info('Probando con configuración hardcodeada...')
                    const tempDiscordConfig = {
                        clientId: "TU_CLIENT_ID_AQUI",
                        smallImageText: "Kindly Klan",
                        smallImageKey: "kindly-logo"
                    }
                    const tempServerConfig = {
                        shortId: "KK",
                        largeImageText: "Jugando en Kindly Klan",
                        largeImageKey: "server-kindly"
                    }
                    
                    try {
                        DiscordWrapper.initRPC(tempDiscordConfig, tempServerConfig)
                        hasRPC = true
                        loggerLaunchSuite.info('Discord RPC iniciado con configuración temporal')
                    proc.on('close', (code, signal) => {
                            loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                            DiscordWrapper.shutdownRPC()
                            hasRPC = false
                            
                        if(gameStartTime != null && currentServer != null) {
                            const now = Date.now()
                                const playedMinutes = Math.floor((now - gameStartTime) / 60000)
                            loggerLaunchSuite.info(`Añadiendo ${playedMinutes} minutos de tiempo de juego a ${currentServer}`)
                            ConfigManager.addPlayTime(currentServer, playedMinutes)
                            ConfigManager.save()
                            gameStartTime = null
                            currentServer = null
                        }
                        
                        proc = null
                            loggerLaunchSuite.info('Proceso de Minecraft terminado, referencia limpiada')
                        })
                    } catch (err) {
                        loggerLaunchSuite.error('Error al iniciar Discord RPC temporal:', err)
                        proc.on('close', (code, signal) => {
                            if(gameStartTime != null && currentServer != null) {
                                const now = Date.now()
                                const playedMinutes = Math.floor((now - gameStartTime) / 60000)
                                loggerLaunchSuite.info(`Añadiendo ${playedMinutes} minutos de tiempo de juego a ${currentServer}`)
                                ConfigManager.addPlayTime(currentServer, playedMinutes)
                                ConfigManager.save()
                                gameStartTime = null
                                currentServer = null
                            }
                            
                            proc = null
                            loggerLaunchSuite.info('Proceso de Minecraft terminado, referencia limpiada')
                        })
                    }
                }
            } catch(err) {

                loggerLaunchSuite.error('Error during launch', err)
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }

    } catch (error) {
        loggerLaunchSuite.error('Error during whitelist verification:', error)
        showLaunchFailure(
            Lang.queryJS('landing.whitelist.verificationError') || 'Error al verificar la whitelist',
            Lang.queryJS('landing.whitelist.contactAdmin') || 'Contacta al administrador para más detalles.'
        )
        return
        }
    }
}

/**
 * News Loading Functions
 */

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsArticleComments           = document.getElementById('newsArticleComments')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const nELoadSpan                    = document.getElementById('nELoadSpan')

// News slide caches.
let newsActive = false
let newsGlideCount = 0

/**
 * Show the news UI via a slide animation.
 * 
 * @param {boolean} up True to slide up, otherwise false. 
 */
function slide_(up){
    const lCUpper = document.querySelector('#landingContainer > #upper')
    const lCLLeft = document.querySelector('#landingContainer > #lower > #left')
    const lCLCenter = document.querySelector('#landingContainer > #lower > #center')
    const lCLRight = document.querySelector('#landingContainer > #lower > #right')
    const newsBtn = document.querySelector('#landingContainer > #lower > #center #content')
    const landingContainer = document.getElementById('landingContainer')
    const newsContainer = document.querySelector('#landingContainer > #newsContainer')

    newsGlideCount++

    if(up){
        lCUpper.style.top = '-200vh'
        lCLLeft.style.top = '-200vh'
        lCLCenter.style.top = '-200vh'
        lCLRight.style.top = '-200vh'
        newsBtn.style.top = '130vh'
        newsContainer.style.top = '0px'
        landingContainer.style.background = 'rgba(0, 0, 0, 0.50)'
        setTimeout(() => {
            if(newsGlideCount === 1){
                lCLCenter.style.transition = 'none'
                newsBtn.style.transition = 'none'
            }
            newsGlideCount--
        }, 2000)
    } else {
        setTimeout(() => {
            newsGlideCount--
        }, 2000)
        landingContainer.style.background = null
        lCLCenter.style.transition = null
        newsBtn.style.transition = null
        newsContainer.style.top = '100%'
        lCUpper.style.top = '0px'
        lCLLeft.style.top = '0px'
        lCLCenter.style.top = '0px'
        lCLRight.style.top = '0px'
        newsBtn.style.top = '10px'
    }
}

// Bind news button.
document.getElementById('newsButton').onclick = () => {
    // Toggle tabbing.
    if(newsActive){
        $('#landingContainer *').removeAttr('tabindex')
        $('#newsContainer *').attr('tabindex', '-1')
    } else {
        $('#landingContainer *').attr('tabindex', '-1')
        $('#newsContainer, #newsContainer *, #lower, #lower #center *').removeAttr('tabindex')
        if(newsAlertShown){
            $('#newsButtonAlert').fadeOut(2000)
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    }
    slide_(!newsActive)
    newsActive = !newsActive
}

// Array to store article meta.
let newsArr = null

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}

newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
        newsContent.setAttribute('scrolled', '')
    } else {
        newsContent.removeAttribute('scrolled')
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = false

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
    $(newsButtonAlert).fadeIn(250)
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
async function initNews(){

    setNewsLoading(true)

    const news = await loadNews()

    newsArr = news?.articles || null

    if(newsArr == null){
        // News Loading Failed
        setNewsLoading(false)

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()

    } else if(newsArr.length === 0) {
        // No News Articles
        setNewsLoading(false)

        ConfigManager.setNewsCache({
            date: null,
            content: null,
            dismissed: false
        })
        ConfigManager.save()

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        // Success
        setNewsLoading(false)

        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.date)
        let isNew = false

        if(cached.date != null && cached.content != null){

            if(new Date(cached.date) >= newDate){

                // Compare Content
                if(cached.content !== newHash){
                    isNew = true
                    showNewsAlert()
                } else {
                    if(!cached.dismissed){
                        isNew = true
                        showNewsAlert()
                    }
                }

            } else {
                isNew = true
                showNewsAlert()
            }

        } else {
            isNew = true
            showNewsAlert()
        }

        if(isNew){
            ConfigManager.setNewsCache({
                date: newDate.getTime(),
                content: newHash,
                dismissed: false
            })
            ConfigManager.save()
        }

        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
    
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }

        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }


}

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
function displayArticle(articleObject, index){
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleTitle.href = articleObject.link
    newsArticleAuthor.innerHTML = 'by ' + articleObject.author
    newsArticleDate.innerHTML = articleObject.date
    newsArticleComments.innerHTML = articleObject.comments
    newsArticleComments.href = articleObject.commentsLink
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

/**
 * Load news information from the RSS feed specified in the
 * distribution index.
 */
async function loadNews(){

    const distroData = await DistroAPI.getDistribution()
    if(!distroData.rawDistribution.rss) {
        loggerLanding.debug('No RSS feed provided.')
        return null
    }

    const promise = new Promise((resolve, reject) => {
        
        const newsFeed = distroData.rawDistribution.rss
        const newsHost = new URL(newsFeed).origin + '/'
        $.ajax({
            url: newsFeed,
            success: (data) => {
                const items = $(data).find('item')
                const articles = []

                for(let i=0; i<items.length; i++){
                // JQuery Element
                    const el = $(items[i])

                    // Resolve date.
                    const date = new Date(el.find('pubDate').text()).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})

                    // Resolve comments.
                    let comments = el.find('slash\\:comments').text() || '0'
                    comments = comments + ' Comment' + (comments === '1' ? '' : 's')

                    // Fix relative links in content.
                    let content = el.find('content\\:encoded').text()
                    let regex = /src="(?!http:\/\/|https:\/\/)(.+?)"/g
                    let matches
                    while((matches = regex.exec(content))){
                        content = content.replace(`"${matches[1]}"`, `"${newsHost + matches[1]}"`)
                    }

                    let link   = el.find('link').text()
                    let title  = el.find('title').text()
                    let author = el.find('dc\\:creator').text()

                    // Generate article.
                    articles.push(
                        {
                            link,
                            title,
                            date,
                            author,
                            content,
                            comments,
                            commentsLink: link + '#comments'
                        }
                    )
                }
                resolve({
                    articles
                })
            },
            timeout: 2500
        }).catch(err => {
            resolve({
                articles: null
            })
        })
    })

    return await promise
}