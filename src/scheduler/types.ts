/**
 * Scheduler Types
 * Defines core types for the job scheduling system
 */

export interface JobRequest {
    id: string
    meetingUrl: string
    botName?: string
    email?: string
    recordingMode?: string
    config?: Record<string, any>
    priority?: number
    createdAt: Date
}

export interface JobStatus {
    id: string
    status: 'queued' | 'provisioning' | 'running' | 'completed' | 'failed'
    containerId?: string
    startedAt?: Date
    completedAt?: Date
    createdAt?: Date
    error?: string
    metadata?: Record<string, any>
}

export interface ContainerConfig {
    image: string
    cpu?: string
    memory?: string
    env?: Record<string, string>
    jobConfig: JobRequest
    timeout?: number
}

export interface ProvisionResult {
    containerId: string
    status: 'success' | 'failed'
    message?: string
    metadata?: Record<string, any>
}
