const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const autoUpdater                       = require('electron-updater').autoUpdater
const ejse                              = require('ejs-electron')
const fs                                = require('fs')
const isDev                             = require('./app/assets/js/isdev')
const path                              = require('path')
const semver                            = require('semver')
const { pathToFileURL }                 = require('url')
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SHELL_OPCODE } = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')

// Setup Lang
LangLoader.setupLanguage()

// Setup auto updater.
function initAutoUpdater(event, data) {

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if(process.platform === 'darwin'){
        autoUpdater.autoDownload = false
    }
    autoUpdater.on('update-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-available', info)
    })
    autoUpdater.on('update-downloaded', (info) => {
        event.sender.send('autoUpdateNotification', 'update-downloaded', info)
    })
    autoUpdater.on('update-not-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        event.sender.send('autoUpdateNotification', 'checking-for-update')
    })
    autoUpdater.on('error', (err) => {
        event.sender.send('autoUpdateNotification', 'realerror', err)
    }) 
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch(arg){
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            initAutoUpdater(event, data)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            autoUpdater.checkForUpdates()
                .catch(err => {
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if(!data){
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            autoUpdater.quitAndInstall()
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()

// Variable para controlar si se permite cerrar la app
let allowAppQuit = false
let closeTimeout = null

// Interceptar cierre de aplicación
app.on('before-quit', async (event) => {
    if (allowAppQuit) {
        // Limpieza final del proxy cuando se permite el cierre
        try {
            const proxyPath = path.join(__dirname, 'app', 'assets', 'js', 'tcpproxy.js')
                    if (fs.existsSync(proxyPath)) {
            const { proxyInstance } = require('./app/assets/js/tcpproxy')
            if (proxyInstance && proxyInstance.isRunning) {
                await proxyInstance.stopProxy()
            }
        }
        } catch (err) {
            console.warn('Error al detener proxy TCP:', err)
        }
        return
    }

    // Prevenir cierre automático para verificar estado de Minecraft
    event.preventDefault()
    
    // Verificar si hay procesos de Minecraft corriendo y mostrar advertencia
    checkMinecraftProcessAndShowWarning()
})

// Función para verificar procesos de Minecraft y mostrar advertencia
function checkMinecraftProcessAndShowWarning() {
    // Usar la variable global 'win' que ya existe en el código
    const targetWindow = win && !win.isDestroyed() ? win : null
    
    if (!targetWindow) {
        allowAppQuit = true
        app.quit()
        return
    }

    // Verificar que la ventana tenga webContents válidos
    if (!targetWindow.webContents || targetWindow.webContents.isDestroyed()) {
        allowAppQuit = true
        app.quit()
        return
    }

    // Limpiar timeout anterior si existe
    if (closeTimeout) {
        clearTimeout(closeTimeout)
        closeTimeout = null
    }
    
    // Enviar evento al renderer para verificar si Minecraft está corriendo
    targetWindow.webContents.send('check-minecraft-process')
    
    // Timeout de seguridad en caso de que no haya respuesta
    closeTimeout = setTimeout(() => {
        closeTimeout = null
        performAppQuit()
    }, 5000) // 5 segundos de espera máxima
}

// Escuchar respuesta del renderer sobre el estado de Minecraft
ipcMain.on('minecraft-process-status', (event, isRunning) => {
    // Limpiar timeout ya que recibimos respuesta
    if (closeTimeout) {
        clearTimeout(closeTimeout)
        closeTimeout = null
    }
    
    if (isRunning) {
        // Mostrar diálogo de advertencia
        showMinecraftRunningWarning(event.sender)
    } else {
        // Minecraft no está corriendo, cerrar normalmente
        performAppQuit()
    }
})

// Mostrar advertencia cuando Minecraft está corriendo
function showMinecraftRunningWarning(webContents) {
    const { dialog } = require('electron')
    const mainWindow = BrowserWindow.fromWebContents(webContents)
    
    dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Minecraft está ejecutándose',
        message: '¡Atención! Minecraft está corriendo',
        detail: 'Si cierras el launcher ahora, perderás la conexión al servidor porque el proxy TCP se detendrá.\n\n¿Estás seguro de que quieres cerrar el launcher?',
        buttons: [
            'Cancelar',
            'Cerrar de todas formas'
        ],
        defaultId: 0, // Botón por defecto es "Cancelar"
        cancelId: 0,   // Botón de cancelar es "Cancelar"
        icon: path.join(__dirname, 'app', 'assets', 'images', 'SealCircle.png')
    }).then(result => {
        if (result.response === 1) { // Usuario eligió "Cerrar de todas formas"
            performAppQuit()
        }
        // Si eligió cancelar (0), no hacer nada
    }).catch(err => {
        // Si hay error mostrando el diálogo, cerrar normalmente
        performAppQuit()
    })
}

// Función para cerrar la aplicación de forma segura
function performAppQuit() {
    allowAppQuit = true
    app.quit()
}

// Escuchar eventos desde renderer para forzar cierre
ipcMain.on('force-app-quit', () => {
    performAppQuit()
})


const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'

// Microsoft Auth Login
let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose
ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    msftAuthWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLoginTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SealCircle')
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queries = uri.substring(REDIRECT_URI_PREFIX.length).split('#', 1).toString().split('&')
            let queryMap = {}

            queries.forEach(query => {
                const [name, value] = query.split('=')
                queryMap[name] = decodeURI(value)
            })

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })

    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`)
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLogoutTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SealCircle')
    })

    msftLogoutWindow.on('closed', () => {
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win
let logsWindow = null

function createWindow() {

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: getPlatformIcon('SealCircle'),
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })
    remoteMain.enable(win.webContents)

    const data = {
        bkid: Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)),
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }
    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    win.removeMenu()

    win.resizable = true

    win.on('close', (event) => {
        if (allowAppQuit) {
            return
        }
        
        // Prevenir cierre de ventana
        event.preventDefault()
        checkMinecraftProcessAndShowWarning()
    })

    win.on('closed', () => {
        win = null
        // Cerrar ventana de logs si existe
        if (logsWindow) {
            logsWindow.close()
            logsWindow = null
        }
    })
}

// Función para crear la ventana de logs
function createLogsWindow() {
    if (logsWindow) {
        logsWindow.focus()
        return logsWindow
    }

    logsWindow = new BrowserWindow({
        width: 900,
        height: 600,
        icon: getPlatformIcon('SealCircle'),
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        resizable: true,
        parent: win,
        show: false,
        backgroundColor: '#1a1a1a'
    })

    logsWindow.loadURL(pathToFileURL(path.join(__dirname, 'app', 'logs.ejs')).toString())

    logsWindow.once('ready-to-show', () => {
        logsWindow.show()
        logsWindow.focus()
    })

    logsWindow.on('closed', () => {
        logsWindow = null
    })

    remoteMain.enable(logsWindow.webContents)

    return logsWindow
}

// Manejadores IPC para la ventana de logs
ipcMain.on('open-logs-window', (event) => {
    createLogsWindow()
})

ipcMain.on('close-logs-window', (event) => {
    if (logsWindow) {
        logsWindow.close()
        logsWindow = null
    }
})

ipcMain.on('game-log-data', (event, data, type) => {
    if (logsWindow) {
        logsWindow.webContents.send('game-log', data, type)
    }
})

ipcMain.on('game-process-closed', (event, code) => {
    if (logsWindow) {
        logsWindow.webContents.send('game-closed', code)
    }
})

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    let ext
    switch(process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

app.on('ready', createWindow)
app.on('ready', createMenu)

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})