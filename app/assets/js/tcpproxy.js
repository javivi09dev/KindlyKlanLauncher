const net = require('net')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('TCPProxy')

class MinecraftTCPProxy {
    constructor() {
        this.server = null
        this.isRunning = false
        this.config = {
            enabled: false,
            localPort: 8000,
            targetHost: null,
            targetPort: 25565,
            retryAttempts: 3
        }
        this.connections = new Set()
    }

    async fetchProxyConfig() {
        try {
            const timestamp = Date.now()
            const response = await fetch(`http://files.kindlyklan.com:26500/proxy/server_config.json?t=${timestamp}`, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            })
            
            if (!response.ok) {
                throw new Error(`Error al obtener configuración del proxy: ${response.status}`)
            }
            
            const remoteConfig = await response.json()
            
            if (remoteConfig.enabled && remoteConfig.targetHost) {
                this.config = {
                    enabled: remoteConfig.enabled || false,
                    localPort: remoteConfig.localPort || 8000,
                    targetHost: remoteConfig.targetHost,
                    targetPort: remoteConfig.targetPort || 25565,
                    retryAttempts: remoteConfig.retryAttempts || 3
                }
                logger.info('Configuración del proxy actualizada:', this.config)
                return true
            } else {
                logger.info('Proxy deshabilitado en configuración remota')
                this.config.enabled = false
                return false
            }
        } catch (err) {
            logger.warn('No se pudo obtener configuración del proxy:', err.message)
            this.config.enabled = false
            return false
        }
    }

    async startProxy() {
        if (this.isRunning) {
            logger.warn('El proxy ya está ejecutándose')
            return false
        }

        if (!this.config.enabled || !this.config.targetHost) {
            logger.info('Proxy no habilitado o sin host de destino')
            return false
        }

        try {
            this.server = net.createServer((clientSocket) => {
                this.handleClientConnection(clientSocket)
            })

            this.server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    logger.error(`Puerto ${this.config.localPort} ya está en uso`)
                } else {
                    logger.error('Error en el servidor proxy:', err)
                }
                this.isRunning = false
            })

            await new Promise((resolve, reject) => {
                this.server.listen(this.config.localPort, '127.0.0.1', (err) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })

            this.isRunning = true
            logger.info(`Proxy TCP iniciado en localhost:${this.config.localPort} -> ${this.config.targetHost}:${this.config.targetPort}`)
            return true

        } catch (err) {
            logger.error('Error al iniciar el proxy TCP:', err)
            this.isRunning = false
            return false
        }
    }


    handleClientConnection(clientSocket) {
        const clientInfo = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`
        logger.info(`Nueva conexión desde ${clientInfo}`)

        const targetSocket = new net.Socket()
        this.connections.add({ client: clientSocket, target: targetSocket })

        targetSocket.connect(this.config.targetPort, this.config.targetHost, () => {
            logger.info(`Conexión establecida con ${this.config.targetHost}:${this.config.targetPort} para cliente ${clientInfo}`)
        })

        clientSocket.on('data', (data) => {
            if (targetSocket.writable) {
                targetSocket.write(data)
            }
        })

        targetSocket.on('data', (data) => {
            if (clientSocket.writable) {
                clientSocket.write(data)
            }
        })

        clientSocket.on('close', (hadError) => {
            logger.info(`Cliente ${clientInfo} desconectado ${hadError ? '(con error)' : ''}`)
            if (!targetSocket.destroyed) {
                targetSocket.destroy()
            }
            this.removeConnection(clientSocket, targetSocket)
        })

        targetSocket.on('close', (hadError) => {
            logger.info(`Servidor ${this.config.targetHost} desconectado para cliente ${clientInfo} ${hadError ? '(con error)' : ''}`)
            if (!clientSocket.destroyed) {
                clientSocket.destroy()
            }
            this.removeConnection(clientSocket, targetSocket)
        })

        clientSocket.on('error', (err) => {
            logger.warn(`Error en conexión del cliente ${clientInfo}:`, err.message)
            if (!targetSocket.destroyed) {
                targetSocket.destroy()
            }
            this.removeConnection(clientSocket, targetSocket)
        })

        targetSocket.on('error', (err) => {
            logger.warn(`Error conectando con ${this.config.targetHost} para cliente ${clientInfo}:`, err.message)
            if (!clientSocket.destroyed) {
                clientSocket.destroy()
            }
            this.removeConnection(clientSocket, targetSocket)
        })
    }

    removeConnection(clientSocket, targetSocket) {
        for (const conn of this.connections) {
            if (conn.client === clientSocket || conn.target === targetSocket) {
                this.connections.delete(conn)
                break
            }
        }
    }

    async stopProxy() {
        if (!this.isRunning || !this.server) {
            return
        }

        try {
            for (const conn of this.connections) {
                if (!conn.client.destroyed) conn.client.destroy()
                if (!conn.target.destroyed) conn.target.destroy()
            }
            this.connections.clear()

            await new Promise((resolve) => {
                this.server.close(() => {
                    resolve()
                })
            })

            this.isRunning = false
            this.server = null
            logger.info('Proxy TCP detenido')

        } catch (err) {
            logger.error('Error al detener el proxy:', err)
        }
    }

    async restartProxy() {
        await this.stopProxy()
        const configOk = await this.fetchProxyConfig()
        if (configOk) {
            await this.startProxy()
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            config: this.config,
            activeConnections: this.connections.size
        }
    }
}

const proxyInstance = new MinecraftTCPProxy()

module.exports = {
    MinecraftTCPProxy,
    proxyInstance
} 