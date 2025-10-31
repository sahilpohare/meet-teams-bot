/**
 * Podman/Docker Local Adapter
 * Provisions containers using Podman or Docker on the local machine
 * Replicates the functionality of run_bot.js
 */

import { IContainerAdapter } from './ContainerAdapter'
import { ContainerConfig, ProvisionResult } from '../types'
import { logger } from '../utils/logger'
import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'

const execAsync = promisify(exec)

export interface PodmanAdapterConfig {
    containerEngine?: 'podman' | 'docker'
    recordingsPath?: string
    autoDetect?: boolean
}

export class PodmanAdapter implements IContainerAdapter {
    private containerEngine: 'podman' | 'docker'
    private recordingsPath: string
    private runningContainers: Map<string, ChildProcess> = new Map()

    constructor(config: PodmanAdapterConfig = {}) {
        this.recordingsPath =
            config.recordingsPath || path.join(process.cwd(), 'recordings')
        this.containerEngine = config.containerEngine || 'podman'

        if (config.autoDetect) {
            this.containerEngine = this.detectContainerEngine()
        }
    }

    /**
     * Auto-detect container engine (podman or docker)
     */
    private detectContainerEngine(): 'podman' | 'docker' {
        try {
            execAsync('docker --version').then(() => {
                return 'docker'
            })
        } catch {
            try {
                execAsync('podman --version').then(() => {
                    logger.info(
                        '[Podman] Docker not found, using Podman as container engine'
                    )
                    return 'podman'
                })
            } catch {
                logger.warn(
                    '[Podman] Neither Docker nor Podman found, defaulting to podman'
                )
            }
        }
        return 'podman'
    }

    async provision(config: ContainerConfig): Promise<ProvisionResult> {
        const jobId = config.jobConfig.id
        logger.info(
            `[Podman] Provisioning container for job ${jobId} using ${this.containerEngine}`
        )

        try {
            // Ensure recordings directory exists
            const jobRecordingsPath = path.join(this.recordingsPath, jobId)
            if (!fs.existsSync(jobRecordingsPath)) {
                fs.mkdirSync(jobRecordingsPath, { recursive: true })
            }

            // Build container configuration JSON
            const containerConfig = {
                id: jobId,
                meeting_url: config.jobConfig.meetingUrl,
                bot_name: config.jobConfig.botName || 'Recording Bot',
                email: config.jobConfig.email || 'bot@example.com',
                recording_mode:
                    config.jobConfig.recordingMode || 'speaker_view',
                bot_uuid: jobId,
                user_token: 'scheduler-token',
                user_id: 999,
                session_id: `scheduler-${jobId}`,
                environ: 'scheduler',
                local_recording_server_location: 'docker',
                ...config.jobConfig.config,
            }

            const configJson = JSON.stringify(containerConfig)

            // Build container run command
            const containerArgs = [
                'run',
                '-i',
                '--rm',
                '-p',
                '3000',
                '-v',
                `${path.resolve(this.recordingsPath)}:/app/data`,
                '-e',
                `RECORDING=${config.env?.RECORDING || 'true'}`,
            ]

            // Add custom environment variables
            if (config.env) {
                for (const [key, value] of Object.entries(config.env)) {
                    if (key !== 'RECORDING') {
                        containerArgs.push('-e', `${key}=${value}`)
                    }
                }
            }

            containerArgs.push(config.image)

            logger.info(
                `[Podman] Starting container with command: ${this.containerEngine} ${containerArgs.join(' ')}`
            )

            // Spawn container process
            const containerProcess = spawn(
                this.containerEngine,
                containerArgs,
                {
                    stdio: ['pipe', 'pipe', 'pipe'],
                }
            )

            // Send config via stdin
            containerProcess.stdin.write(configJson)
            containerProcess.stdin.end()

            // Track running container
            this.runningContainers.set(jobId, containerProcess)

            // Handle container output
            containerProcess.stdout.on('data', (data) => {
                const output = data.toString()
                if (output.includes('ERROR') || output.includes('error')) {
                    logger.error(`[Podman:${jobId}] ${output}`)
                } else {
                    logger.info(`[Podman:${jobId}] ${output}`)
                }
            })

            containerProcess.stderr.on('data', (data) => {
                logger.error(`[Podman:${jobId}] ${data.toString()}`)
            })

            // Handle container exit
            containerProcess.on('close', (code) => {
                this.runningContainers.delete(jobId)
                if (code === 0) {
                    logger.info(
                        `[Podman] Container for job ${jobId} completed successfully`
                    )
                } else {
                    logger.error(
                        `[Podman] Container for job ${jobId} exited with code ${code}`
                    )
                }
            })

            return {
                containerId: jobId,
                status: 'success',
                message: `${this.containerEngine} container started successfully`,
                metadata: {
                    platform: 'local',
                    containerEngine: this.containerEngine,
                    recordingsPath: jobRecordingsPath,
                    pid: containerProcess.pid,
                },
            }
        } catch (error) {
            logger.error(`[Podman] Failed to provision container:`, error)
            return {
                containerId: '',
                status: 'failed',
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            }
        }
    }

    async getStatus(
        containerId: string
    ): Promise<'running' | 'completed' | 'failed' | 'unknown'> {
        logger.info(`[Podman] Getting status for ${containerId}`)

        // Check if process is still in our tracking map
        const process = this.runningContainers.get(containerId)
        if (process && !process.killed) {
            return 'running'
        }

        // Check recordings directory for completion
        const recordingsPath = path.join(this.recordingsPath, containerId)
        if (fs.existsSync(recordingsPath)) {
            const files = fs.readdirSync(recordingsPath)
            const hasVideo = files.some((f) => f.endsWith('.mp4'))
            if (hasVideo) {
                return 'completed'
            }
        }

        // If not in map and no recordings, check container status
        try {
            const { stdout } = await execAsync(
                `${this.containerEngine} ps -a --filter "label=job-id=${containerId}" --format "{{.Status}}"`
            )

            if (stdout.includes('Up')) {
                return 'running'
            } else if (stdout.includes('Exited (0)')) {
                return 'completed'
            } else if (stdout.includes('Exited')) {
                return 'failed'
            }
        } catch (error) {
            logger.error(`[Podman] Error checking status:`, error)
        }

        return 'unknown'
    }

    async stop(containerId: string): Promise<void> {
        logger.info(`[Podman] Stopping container ${containerId}`)

        const process = this.runningContainers.get(containerId)
        if (process && !process.killed) {
            process.kill('SIGTERM')
            this.runningContainers.delete(containerId)
        }

        // Also try to stop via container engine
        try {
            await execAsync(
                `${this.containerEngine} stop $(${this.containerEngine} ps -q --filter "label=job-id=${containerId}")`
            )
        } catch (error) {
            // Container might already be stopped
            logger.debug(`[Podman] Container ${containerId} already stopped`)
        }
    }

    async getLogs(containerId: string): Promise<string> {
        logger.info(`[Podman] Getting logs for ${containerId}`)

        try {
            const { stdout } = await execAsync(
                `${this.containerEngine} logs $(${this.containerEngine} ps -aq --filter "label=job-id=${containerId}" | head -1)`
            )
            return stdout
        } catch (error) {
            logger.error(`[Podman] Error getting logs:`, error)
            return 'Logs not available'
        }
    }

    async cleanup(containerId: string): Promise<void> {
        logger.info(`[Podman] Cleaning up container ${containerId}`)

        await this.stop(containerId)

        // Remove container
        try {
            await execAsync(
                `${this.containerEngine} rm -f $(${this.containerEngine} ps -aq --filter "label=job-id=${containerId}")`
            )
        } catch (error) {
            logger.debug(`[Podman] No container to remove for ${containerId}`)
        }
    }
}
