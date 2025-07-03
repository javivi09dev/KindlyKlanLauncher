const { LoggerUtil } = require('helios-core')
const { downloadFile } = require('helios-core/dl')
const { getConfigForDownloadType, isRetryableError, testUrls } = require('./downloadconfig')
const https = require('https')
const http = require('http')

const logger = LoggerUtil.getLogger('DownloadManager')

/**
 * Gestor de descargas con reintentos, timeouts y concurrencia
 */
class EnhancedDownloadManager {
    constructor(options = {}) {
        this.config = {
            maxRetries: options.maxRetries || 3,
            timeout: options.timeout || 30000,
            retryDelay: options.retryDelay || 1000,
            concurrentDownloads: options.concurrentDownloads || 3,
            exponentialBackoff: options.exponentialBackoff !== false,
            ...options
        }
        this.downloadQueue = []
        this.activeDownloads = new Set()
    }

    /**
     * Descargar un archivo con reintentos y timeout
     */
    async downloadWithRetry(url, path, onProgress, attempt = 1) {
        const maxAttempts = this.config.maxRetries + 1
        
        try {
            logger.info(`Descargando ${url} (intento ${attempt}/${maxAttempts})`)
            
            const downloadPromise = downloadFile(url, path, onProgress)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Download timeout')), this.config.timeout)
            })
            
            await Promise.race([downloadPromise, timeoutPromise])
            logger.info(`Descarga completada: ${url}`)
            return true
            
        } catch (error) {
            logger.warn(`Fallo en descarga ${url} (intento ${attempt}): ${error.message}`)
            
            if (attempt < maxAttempts && isRetryableError(error)) {
                let delay = this.config.exponentialBackoff 
                    ? this.config.retryDelay * Math.pow(2, attempt - 1)
                    : this.config.retryDelay
                
                if (this.config.maxRetryDelay) {
                    delay = Math.min(delay, this.config.maxRetryDelay)
                }
                
                logger.info(`Reintentando en ${delay}ms... (error: ${error.code || error.message})`)
                await this.sleep(delay)
                return this.downloadWithRetry(url, path, onProgress, attempt + 1)
                
            } else if (attempt >= maxAttempts) {
                logger.error(`Descarga fallida permanentemente después de ${maxAttempts} intentos: ${url}`)
                throw new Error(`Download failed after ${maxAttempts} attempts: ${error.message}`)
                
            } else {
                logger.error(`Error no reintentable en descarga: ${url} - ${error.message}`)
                throw error
            }
        }
    }

    /**
     * Descargar múltiples archivos con concurrencia limitada
     */
    async downloadConcurrent(downloads, globalProgress) {
        const totalFiles = downloads.length
        let completedFiles = 0
        let totalBytes = 0
        let downloadedBytes = 0

        downloads.forEach(download => {
            totalBytes += download.size || 0
        })

        const semaphore = new Semaphore(this.config.concurrentDownloads)
        const downloadPromises = downloads.map(async (download) => {
            await semaphore.acquire()
            
            try {
                await this.downloadWithRetry(
                    download.url, 
                    download.path, 
                    ({ transferred }) => {
                        if (download.onProgress) {
                            download.onProgress(transferred)
                        }
                        
                        if (globalProgress && totalBytes > 0) {
                            const progress = Math.min(100, (downloadedBytes + transferred) / totalBytes * 100)
                            globalProgress(progress)
                        }
                    }
                )
                
                completedFiles++
                downloadedBytes += download.size || 0
                
                if (globalProgress) {
                    const progress = totalBytes > 0 ? (downloadedBytes / totalBytes * 100) : (completedFiles / totalFiles * 100)
                    globalProgress(Math.min(100, progress))
                }
                
            } finally {
                semaphore.release()
            }
        })

        await Promise.all(downloadPromises)
        logger.info(`Todas las descargas completadas: ${totalFiles} archivos`)
    }

    /**
     * Verificar conectividad de red
     */
    async checkConnectivity(testUrl = 'https://files.kindlyklan.com:26500/ping') {
        try {
            const startTime = Date.now()
            const response = await fetch(testUrl, { 
                method: 'HEAD',
                timeout: 5000 
            })
            const responseTime = Date.now() - startTime
            
            return {
                connected: response.ok,
                responseTime,
                quality: responseTime < 1000 ? 'good' : responseTime < 3000 ? 'fair' : 'poor'
            }
        } catch (error) {
            logger.warn('Error verificando conectividad:', error.message)
            return { connected: false, responseTime: -1, quality: 'none' }
        }
    }

    /**
     * Optimizar configuración basada en conectividad
     */
    async optimizeConfig() {
        try {
            const connectionQuality = await this.testConnectivity()
            const optimizedConfig = getConfigForDownloadType('default', connectionQuality)
            this.config = { ...this.config, ...optimizedConfig }
            logger.info(`Configuration optimized for ${connectionQuality} connection`)
        } catch (err) {
            logger.warn('Could not optimize configuration:', err.message)
            const conservativeConfig = getConfigForDownloadType('default', 'conservative')
            this.config = { ...this.config, ...conservativeConfig }
        }
    }

    /**
     * Probar conectividad y determinar calidad de conexión
     */
    async testConnectivity() {
        const testPromises = testUrls.map(url => this.pingUrl(url))
        const results = await Promise.allSettled(testPromises)
        
        const successfulTests = results.filter(r => r.status === 'fulfilled')
        const avgLatency = successfulTests.length > 0 
            ? successfulTests.reduce((acc, r) => acc + r.value, 0) / successfulTests.length
            : 1000

        logger.info(`Network test: ${successfulTests.length}/${testUrls.length} successful, avg latency: ${avgLatency}ms`)

        if (successfulTests.length === 0) return 'conservative'
        if (avgLatency < 100 && successfulTests.length === testUrls.length) return 'fast'
        if (avgLatency > 500 || successfulTests.length < testUrls.length * 0.7) return 'slow'
        return 'default'
    }

    /**
     * Ping a una URL para medir latencia
     */
    async pingUrl(url) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now()
            const request = url.startsWith('https') ? https : http
            
            const req = request.get(url, { timeout: 5000 }, (res) => {
                const latency = Date.now() - startTime
                resolve(latency)
                res.destroy()
            })

            req.on('error', () => reject(new Error('Ping failed')))
            req.on('timeout', () => {
                req.destroy()
                reject(new Error('Ping timeout'))
            })
        })
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}

/**
 * Semáforo para controlar concurrencia
 */
class Semaphore {
    constructor(count) {
        this.count = count
        this.waiting = []
    }

    async acquire() {
        if (this.count > 0) {
            this.count--
            return
        }

        return new Promise(resolve => {
            this.waiting.push(resolve)
        })
    }

    release() {
        this.count++
        if (this.waiting.length > 0) {
            const resolve = this.waiting.shift()
            this.count--
            resolve()
        }
    }
}

module.exports = { EnhancedDownloadManager } 