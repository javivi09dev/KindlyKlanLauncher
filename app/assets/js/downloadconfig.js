/**
 * Configuraciones para el sistema de descargas
 */
const downloadConfigs = {
    default: {
        maxRetries: 3,
        timeout: 30000,
        concurrentDownloads: 3,
        exponentialBackoff: true,
        retryDelay: 1000,
        maxRetryDelay: 30000
    },

    slow: {
        maxRetries: 5,
        timeout: 60000,
        concurrentDownloads: 2,
        exponentialBackoff: true,
        retryDelay: 2000,
        maxRetryDelay: 60000
    },

    fast: {
        maxRetries: 2,
        timeout: 15000,
        concurrentDownloads: 6,
        exponentialBackoff: true,
        retryDelay: 500,
        maxRetryDelay: 10000
    },

    conservative: {
        maxRetries: 8,
        timeout: 90000,
        concurrentDownloads: 1,
        exponentialBackoff: true,
        retryDelay: 3000,
        maxRetryDelay: 120000
    },

    largeFiles: {
        maxRetries: 5,
        timeout: 300000,
        concurrentDownloads: 2,
        exponentialBackoff: true,
        retryDelay: 5000,
        maxRetryDelay: 180000,
        chunkSize: 1024 * 1024 * 10
    }
}

/**
 * URLs de prueba para verificar conectividad
 */
const testUrls = [
    'http://files.kindlyklan.com:26500/ping',
    'https://launcher.mojang.com/v1/ping'
]

/**
 * Configuración de timeouts específicos
 */
const timeouts = {
    connectivity: 5000,
    fileValidation: 120000,
    javaDownload: 600000,
    assetsDownload: 1800000
}

/**
 * Configuración de reintentos por tipo de error
 */
const retryConfig = {
    networkErrors: ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'],
    temporaryErrors: ['EBUSY', 'EMFILE', 'ENFILE'],
    retryableHttpCodes: [408, 429, 500, 502, 503, 504],
    nonRetryableHttpCodes: [400, 401, 403, 404, 410]
}

/**
 * Configuración de progreso y logs
 */
const progressConfig = {
    updateInterval: 500,
    logInterval: 5000,
    detailedLogging: false
}

/**
 * Obtener configuración basada en el tipo de descarga
 */
function getConfigForDownloadType(type, connectionQuality = 'fair') {
    const baseConfig = downloadConfigs[connectionQuality] || downloadConfigs.default
    
    switch (type) {
        case 'java':
            return {
                ...baseConfig,
                timeout: timeouts.javaDownload,
                maxRetries: Math.max(baseConfig.maxRetries, 3)
            }
        case 'assets':
            return {
                ...baseConfig,
                timeout: timeouts.assetsDownload,
                concurrentDownloads: Math.min(baseConfig.concurrentDownloads, 4)
            }
        case 'libraries':
            return {
                ...baseConfig,
                concurrentDownloads: Math.max(baseConfig.concurrentDownloads, 3)
            }
        case 'large':
            return downloadConfigs.largeFiles
        default:
            return baseConfig
    }
}

/**
 * Verificar si un error es reintentable
 */
function isRetryableError(error) {
    if (!error) return false
    
    // Verificar códigos de error de red
    if (retryConfig.networkErrors.includes(error.code)) return true
    
    // Verificar errores temporales
    if (retryConfig.temporaryErrors.includes(error.code)) return true
    
    // Verificar códigos HTTP
    if (error.response && error.response.status) {
        return retryConfig.retryableHttpCodes.includes(error.response.status)
    }
    
    // Timeouts son siempre reintentables
    if (error.message && error.message.includes('timeout')) return true
    
    return false
}

module.exports = {
    downloadConfigs,
    testUrls,
    timeouts,
    retryConfig,
    progressConfig,
    getConfigForDownloadType,
    isRetryableError
} 