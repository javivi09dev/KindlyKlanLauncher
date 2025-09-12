const { ipcRenderer } = require('electron')
const { LoggerUtil } = require('helios-core')
const semver = require('semver')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')

const logger = LoggerUtil.getLogger('UpdateChecker')

class UpdateChecker {
    constructor() {
        this.currentVersion = null
        this.downloadedVersion = null
        this.updateInfo = null
        this.isChecking = false
    }

    /**
     * Verifica si hay una actualización descargada más reciente que la versión actual
     * @returns {Promise<boolean>} True si hay una actualización disponible
     */
    async checkForDownloadedUpdate() {
        try {
            this.isChecking = true
            logger.info('Verificando si hay actualizaciones descargadas...')

            // Obtener la versión actual del launcher
            this.currentVersion = require('@electron/remote').app.getVersion()
            logger.info(`Versión actual: ${this.currentVersion}`)

            // Buscar archivos de actualización descargados
            const updateInfo = await this.findDownloadedUpdate()
            
            if (updateInfo) {
                this.downloadedVersion = updateInfo.version
                this.updateInfo = updateInfo
                
                logger.info(`Versión descargada encontrada: ${this.downloadedVersion}`)
                
                // Comparar versiones usando semver
                const hasNewerVersion = semver.gt(this.downloadedVersion, this.currentVersion)
                
                if (hasNewerVersion) {
                    logger.info('Se encontró una versión más reciente descargada')
                    return true
                } else {
                    logger.info('La versión descargada no es más reciente que la actual')
                    return false
                }
            } else {
                logger.info('No se encontraron actualizaciones descargadas')
                return false
            }

        } catch (error) {
            logger.error('Error al verificar actualizaciones descargadas:', error)
            return false
        } finally {
            this.isChecking = false
        }
    }

    /**
     * Busca archivos de actualización descargados en el directorio de actualizaciones
     * @returns {Promise<Object|null>} Información de la actualización o null si no se encuentra
     */
    async findDownloadedUpdate() {
        try {
            const possiblePaths = [
                // Windows 
                path.join(os.homedir(), 'AppData', 'Roaming', 'kindlyklanlauncher', 'pending'),
                path.join(os.homedir(), 'AppData', 'Local', 'kindlyklanlauncher', 'pending'),
                path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'kindlyklanlauncher', 'pending'),
                // macOS
                path.join(os.homedir(), 'Library', 'Application Support', 'kindlyklanlauncher', 'pending'),
                // Linux
                path.join(os.homedir(), '.config', 'kindlyklanlauncher', 'pending'),
                // Directorio de datos del launcher
                path.join(require('@electron/remote').app.getPath('userData'), 'pending'),
                // Directorio de actualizaciones de electron-updater
                path.join(require('@electron/remote').app.getPath('userData'), 'updates'),
                // Directorio de instalación
                path.join(process.resourcesPath, '..', 'pending')
            ]

            for (const updatePath of possiblePaths) {
                if (await fs.pathExists(updatePath)) {
                    logger.info(`Verificando directorio de actualizaciones: ${updatePath}`)
                    
                    const files = await fs.readdir(updatePath)
                    const updateFiles = files.filter(file => 
                        file.endsWith('.exe') || 
                        file.endsWith('.dmg') || 
                        file.endsWith('.AppImage') ||
                        file.endsWith('.zip') ||
                        file.endsWith('.msi') ||
                        file.endsWith('.deb') ||
                        file.endsWith('.rpm')
                    )

                    if (updateFiles.length > 0) {
                        let latestFile = null
                        let latestTime = 0

                        for (const file of updateFiles) {
                            const filePath = path.join(updatePath, file)
                            const stats = await fs.stat(filePath)
                            
                            if (stats.mtime.getTime() > latestTime) {
                                latestTime = stats.mtime.getTime()
                                latestFile = file
                            }
                        }

                        if (latestFile) {
                            const versionMatch = latestFile.match(/v?(\d+\.\d+\.\d+)/)
                            if (versionMatch) {
                                logger.info(`Encontrada actualización: ${latestFile} (versión ${versionMatch[1]})`)
                                return {
                                    version: versionMatch[1],
                                    file: latestFile,
                                    path: path.join(updatePath, latestFile),
                                    downloadTime: new Date(latestTime)
                                }
                            }
                        }
                    }
                }
            }

            const metadataPath = path.join(require('@electron/remote').app.getPath('userData'), 'update-info.json')
            if (await fs.pathExists(metadataPath)) {
                try {
                    const metadata = await fs.readJson(metadataPath)
                    if (metadata.version && semver.gt(metadata.version, this.currentVersion)) {
                        logger.info(`Encontrada actualización en metadatos: ${metadata.version}`)
                        return {
                            version: metadata.version,
                            file: metadata.fileName || 'update',
                            path: metadata.path || '',
                            downloadTime: new Date(metadata.downloadTime || Date.now())
                        }
                    }
                } catch (error) {
                    logger.warn('Error al leer metadatos de actualización:', error)
                }
            }

            return null

        } catch (error) {
            logger.error('Error al buscar actualizaciones descargadas:', error)
            return null
        }
    }

    /**
     * Muestra la pantalla de notificación de actualización
     */
    showUpdateNotification() {
        const notification = document.getElementById('updateNotification')
        const currentVersionSpan = document.getElementById('currentVersion')
        const newVersionSpan = document.getElementById('newVersion')

        if (notification && currentVersionSpan && newVersionSpan) {
            currentVersionSpan.textContent = this.currentVersion
            newVersionSpan.textContent = this.downloadedVersion
            notification.style.display = 'flex'

            // Configurar event listeners
            this.setupNotificationListeners()
        } else {
            logger.error('No se pudo encontrar la pantalla de notificación de actualización')
        }
    }

    /**
     * Configura los event listeners para la pantalla de notificación
     */
    setupNotificationListeners() {
        const installNowBtn = document.getElementById('updateInstallNow')
        const installLaterBtn = document.getElementById('updateInstallLater')

        if (installNowBtn) {
            installNowBtn.addEventListener('click', () => {
                this.installUpdate()
            })
        }

        if (installLaterBtn) {
            installLaterBtn.addEventListener('click', () => {
                this.hideUpdateNotification()
            })
        }
    }

    /**
     * Oculta la pantalla de notificación de actualización
     */
    hideUpdateNotification() {
        const notification = document.getElementById('updateNotification')
        if (notification) {
            notification.style.display = 'none'
        }
    }

    /**
     * Instala la actualización
     */
    installUpdate() {
        logger.info('Iniciando instalación de actualización...')
        
        // Enviar comando al proceso principal para instalar la actualización
        ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
    }


    async checkAndShowUpdateNotification() {
        try {
            const hasUpdate = await this.checkForDownloadedUpdate()
            
            if (hasUpdate) {
                this.showUpdateNotification()
                return true
            }
            
            return false
        } catch (error) {
            return false
        }
    }
}

const updateChecker = new UpdateChecker()

module.exports = { UpdateChecker, updateChecker }
