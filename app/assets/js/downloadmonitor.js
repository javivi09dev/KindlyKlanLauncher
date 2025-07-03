const { LoggerUtil } = require('helios-core')
const fs = require('fs')
const path = require('path')

const logger = LoggerUtil.getLogger('DownloadMonitor')

/**
 * Monitor de descargas
 */
class DownloadMonitor {
    constructor() {
        this.downloadStats = new Map()
        this.sessionStats = {
            startTime: Date.now(),
            totalDownloads: 0,
            successfulDownloads: 0,
            failedDownloads: 0,
            totalBytes: 0,
            errors: [],
            slowDownloads: []
        }
    }

    /**
     * Iniciar monitoreo de una descarga
     */
    startDownload(url, expectedSize = 0) {
        const downloadId = this.generateDownloadId(url)
        this.downloadStats.set(downloadId, {
            url,
            expectedSize,
            startTime: Date.now(),
            bytesDownloaded: 0,
            status: 'downloading',
            attempts: 1,
            errors: []
        })
        
        this.sessionStats.totalDownloads++
        logger.debug(`Started monitoring download: ${url}`)
        return downloadId
    }

    /**
     * Actualizar progreso de descarga
     */
    updateProgress(downloadId, bytesDownloaded) {
        const stats = this.downloadStats.get(downloadId)
        if (stats) {
            stats.bytesDownloaded = bytesDownloaded
            stats.lastUpdate = Date.now()
            
            const elapsed = Date.now() - stats.startTime
            const speed = bytesDownloaded / (elapsed / 1000)
            
            if (elapsed > 30000 && speed < 50000) {
                this.flagSlowDownload(downloadId, speed)
            }
        }
    }

    /**
     * Marcar descarga como completada
     */
    completeDownload(downloadId, success = true, error = null) {
        const stats = this.downloadStats.get(downloadId)
        if (stats) {
            stats.endTime = Date.now()
            stats.status = success ? 'completed' : 'failed'
            stats.duration = stats.endTime - stats.startTime
            
            if (success) {
                this.sessionStats.successfulDownloads++
                this.sessionStats.totalBytes += stats.bytesDownloaded
            } else {
                this.sessionStats.failedDownloads++
                if (error) {
                    stats.errors.push({
                        timestamp: Date.now(),
                        error: error.message || error.toString(),
                        code: error.code
                    })
                    this.sessionStats.errors.push({
                        url: stats.url,
                        error: error.message || error.toString(),
                        timestamp: Date.now()
                    })
                }
            }
            
            logger.info(`Download ${success ? 'completed' : 'failed'}: ${stats.url} in ${stats.duration}ms`)
        }
    }

    /**
     * Registrar reintento de descarga
     */
    recordRetry(downloadId, error) {
        const stats = this.downloadStats.get(downloadId)
        if (stats) {
            stats.attempts++
            stats.errors.push({
                timestamp: Date.now(),
                error: error.message || error.toString(),
                code: error.code,
                attempt: stats.attempts - 1
            })
            logger.warn(`Download retry #${stats.attempts - 1} for ${stats.url}: ${error.message}`)
        }
    }

    /**
     * Marcar descarga como lenta
     */
    flagSlowDownload(downloadId, speed) {
        const stats = this.downloadStats.get(downloadId)
        if (stats && !stats.flaggedSlow) {
            stats.flaggedSlow = true
            this.sessionStats.slowDownloads.push({
                url: stats.url,
                speed: Math.round(speed),
                timestamp: Date.now()
            })
            logger.warn(`Slow download detected: ${stats.url} at ${Math.round(speed/1024)}KB/s`)
        }
    }

    /**
     * Generar reporte de sesión
     */
    generateSessionReport() {
        const duration = Date.now() - this.sessionStats.startTime
        const successRate = this.sessionStats.totalDownloads > 0 
            ? (this.sessionStats.successfulDownloads / this.sessionStats.totalDownloads * 100).toFixed(1)
            : 0

        const report = {
            sessionDuration: duration,
            totalDownloads: this.sessionStats.totalDownloads,
            successfulDownloads: this.sessionStats.successfulDownloads,
            failedDownloads: this.sessionStats.failedDownloads,
            successRate: `${successRate}%`,
            totalBytesDownloaded: this.sessionStats.totalBytes,
            averageSpeed: this.sessionStats.totalBytes > 0 
                ? Math.round(this.sessionStats.totalBytes / (duration / 1000))
                : 0,
            errors: this.sessionStats.errors.length,
            slowDownloads: this.sessionStats.slowDownloads.length,
            commonErrors: this.analyzeCommonErrors(),
            recommendations: this.generateRecommendations()
        }

        return report
    }

    /**
     * Analizar errores comunes
     */
    analyzeCommonErrors() {
        const errorCounts = {}
        this.sessionStats.errors.forEach(error => {
            const key = error.error.split(':')[0]
            errorCounts[key] = (errorCounts[key] || 0) + 1
        })

        return Object.entries(errorCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([error, count]) => ({ error, count }))
    }

    /**
     * Generar recomendaciones basadas en estadísticas
     */
    generateRecommendations() {
        const recommendations = []
        const stats = this.sessionStats

        if (stats.failedDownloads > stats.successfulDownloads) {
            recommendations.push({
                type: 'critical',
                message: 'Alta tasa de fallos de descarga. Verifica la conexión a internet.',
                action: 'check_connection'
            })
        }

        if (stats.slowDownloads.length > stats.totalDownloads * 0.3) {
            recommendations.push({
                type: 'warning',
                message: 'Muchas descargas lentas detectadas. Considera usar menos descargas concurrentes.',
                action: 'reduce_concurrency'
            })
        }

        const timeoutErrors = stats.errors.filter(e => e.error.includes('timeout')).length
        if (timeoutErrors > 3) {
            recommendations.push({
                type: 'warning',
                message: 'Múltiples timeouts detectados. Aumenta el tiempo de timeout.',
                action: 'increase_timeout'
            })
        }

        const networkErrors = stats.errors.filter(e => 
            e.error.includes('ENOTFOUND') || e.error.includes('ECONNREFUSED')
        ).length
        if (networkErrors > 2) {
            recommendations.push({
                type: 'critical',
                message: 'Errores de conectividad de red. Verifica la configuración de red.',
                action: 'check_network'
            })
        }

        return recommendations
    }

    /**
     * Exportar estadísticas detalladas
     */
    exportDetailedStats() {
        const detailedStats = {
            session: this.sessionStats,
            downloads: Array.from(this.downloadStats.entries()).map(([id, stats]) => ({
                id,
                ...stats
            })),
            report: this.generateSessionReport()
        }

        return detailedStats
    }

    /**
     * Guardar reporte en archivo
     */
    async saveReport(filepath) {
        try {
            const report = this.exportDetailedStats()
            const reportContent = JSON.stringify(report, null, 2)
            
            // Crear directorio si no existe
            const dir = path.dirname(filepath)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }

            fs.writeFileSync(filepath, reportContent, 'utf8')
            logger.info(`Download report saved to: ${filepath}`)
            return true
        } catch (error) {
            logger.error('Failed to save download report:', error.message)
            return false
        }
    }

    /**
     * Generar ID único para descarga
     */
    generateDownloadId(url) {
        const timestamp = Date.now()
        const hash = url.split('/').pop() || 'unknown'
        return `${hash}_${timestamp}`
    }

    /**
     * Limpiar estadísticas antiguas
     */
    cleanup() {
        // Mantener solo las últimas 100 descargas
        if (this.downloadStats.size > 100) {
            const entries = Array.from(this.downloadStats.entries())
                .sort(([,a], [,b]) => (b.startTime || 0) - (a.startTime || 0))
                .slice(0, 100)
            
            this.downloadStats.clear()
            entries.forEach(([id, stats]) => {
                this.downloadStats.set(id, stats)
            })
        }
    }

    /**
     * Obtener estadísticas en tiempo real
     */
    getRealTimeStats() {
        const activeDownloads = Array.from(this.downloadStats.values())
            .filter(stats => stats.status === 'downloading')

        return {
            activeDownloads: activeDownloads.length,
            sessionSuccessRate: this.sessionStats.totalDownloads > 0 
                ? (this.sessionStats.successfulDownloads / this.sessionStats.totalDownloads * 100).toFixed(1)
                : 0,
            currentErrors: this.sessionStats.errors.length,
            slowDownloadsCount: this.sessionStats.slowDownloads.length
        }
    }
}

module.exports = { DownloadMonitor } 