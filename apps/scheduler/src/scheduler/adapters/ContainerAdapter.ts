/**
 * Container Provisioning Adapter Interface
 * Defines the contract for container provisioning across different platforms
 */

import { ContainerConfig, ProvisionResult } from '../types'

export interface IContainerAdapter {
    /**
     * Provision a container with the given configuration
     */
    provision(config: ContainerConfig): Promise<ProvisionResult>

    /**
     * Get the status of a provisioned container
     */
    getStatus(
        containerId: string,
    ): Promise<'running' | 'completed' | 'failed' | 'unknown'>

    /**
     * Stop a running container
     */
    stop(containerId: string): Promise<void>

    /**
     * Get logs from a container
     */
    getLogs(containerId: string): Promise<string>

    /**
     * Clean up container resources
     */
    cleanup(containerId: string): Promise<void>
}
