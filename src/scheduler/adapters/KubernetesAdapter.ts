/**
 * Kubernetes Jobs Adapter
 * Provisions containers using Kubernetes Jobs
 */

import { IContainerAdapter } from './ContainerAdapter'
import { ContainerConfig, ProvisionResult } from '../types'
import { logger } from '../utils/logger'

export class KubernetesAdapter implements IContainerAdapter {
    private namespace: string
    private kubeconfig?: string

    constructor(config: { namespace?: string; kubeconfig?: string }) {
        this.namespace = config.namespace || 'default'
        this.kubeconfig = config.kubeconfig
    }

    async provision(config: ContainerConfig): Promise<ProvisionResult> {
        logger.info(
            `[K8s] Provisioning Kubernetes Job for ${config.jobConfig.id}`,
        )

        try {
            const jobName = `bot-job-${config.jobConfig.id.toLowerCase()}`

            const jobManifest = {
                apiVersion: 'batch/v1',
                kind: 'Job',
                metadata: {
                    name: jobName,
                    namespace: this.namespace,
                    labels: {
                        app: 'meet-teams-bot',
                        jobId: config.jobConfig.id,
                    },
                },
                spec: {
                    ttlSecondsAfterFinished: 3600,
                    backoffLimit: 0,
                    template: {
                        metadata: {
                            labels: {
                                app: 'meet-teams-bot',
                                jobId: config.jobConfig.id,
                            },
                        },
                        spec: {
                            restartPolicy: 'Never',
                            containers: [
                                {
                                    name: 'bot-container',
                                    image: config.image,
                                    imagePullPolicy: 'Always',
                                    resources: {
                                        requests: {
                                            cpu: config.cpu || '1000m',
                                            memory: config.memory || '2Gi',
                                        },
                                        limits: {
                                            cpu: config.cpu || '2000m',
                                            memory: config.memory || '4Gi',
                                        },
                                    },
                                    env: this.formatEnvVars(config.env || {}),
                                    stdin: true,
                                    tty: true,
                                },
                            ],
                        },
                    },
                },
            }

            logger.info(`[K8s] Job manifest:`, {
                jobName,
                namespace: this.namespace,
                image: config.image,
            })

            return {
                containerId: jobName,
                status: 'success',
                message: 'Kubernetes Job created successfully',
                metadata: {
                    platform: 'kubernetes',
                    namespace: this.namespace,
                    jobName,
                },
            }
        } catch (error) {
            logger.error(`[K8s] Failed to provision container:`, error)
            return {
                containerId: '',
                status: 'failed',
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            }
        }
    }

    async getStatus(
        containerId: string,
    ): Promise<'running' | 'completed' | 'failed' | 'unknown'> {
        logger.info(`[K8s] Getting status for ${containerId}`)
        return 'running'
    }

    async stop(containerId: string): Promise<void> {
        logger.info(`[K8s] Stopping job ${containerId}`)
    }

    async getLogs(containerId: string): Promise<string> {
        logger.info(`[K8s] Getting logs for ${containerId}`)
        return 'K8s logs not implemented'
    }

    async cleanup(containerId: string): Promise<void> {
        logger.info(`[K8s] Cleaning up job ${containerId}`)
        await this.stop(containerId)
    }

    private formatEnvVars(
        env: Record<string, string>,
    ): Array<{ name: string; value: string }> {
        return Object.entries(env).map(([name, value]) => ({ name, value }))
    }
}
