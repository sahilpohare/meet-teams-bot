"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PodmanAdapter = void 0;
const tslib_1 = require("tslib");
const logger_1 = require("../utils/logger");
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class PodmanAdapter {
    containerEngine;
    recordingsPath;
    runningContainers = new Map();
    constructor(config = {}) {
        this.recordingsPath =
            config.recordingsPath || path.join(process.cwd(), 'recordings');
        this.containerEngine = config.containerEngine || 'podman';
        if (config.autoDetect) {
            this.containerEngine = this.detectContainerEngine();
        }
    }
    detectContainerEngine() {
        try {
            execAsync('docker --version').then(() => {
                return 'docker';
            });
        }
        catch {
            try {
                execAsync('podman --version').then(() => {
                    logger_1.logger.info('[Podman] Docker not found, using Podman as container engine');
                    return 'podman';
                });
            }
            catch {
                logger_1.logger.warn('[Podman] Neither Docker nor Podman found, defaulting to podman');
            }
        }
        return 'podman';
    }
    async provision(config) {
        const jobId = config.jobConfig.id;
        logger_1.logger.info(`[Podman] Provisioning container for job ${jobId} using ${this.containerEngine}`);
        try {
            const jobRecordingsPath = path.join(this.recordingsPath, jobId);
            if (!fs.existsSync(jobRecordingsPath)) {
                fs.mkdirSync(jobRecordingsPath, { recursive: true });
            }
            const containerConfig = {
                id: jobId,
                meeting_url: config.jobConfig.meetingUrl,
                bot_name: config.jobConfig.botName || 'Recording Bot',
                email: config.jobConfig.email || 'bot@example.com',
                recording_mode: config.jobConfig.recordingMode || 'speaker_view',
                bot_uuid: jobId,
                user_token: 'scheduler-token',
                user_id: 999,
                session_id: `scheduler-${jobId}`,
                environ: 'scheduler',
                local_recording_server_location: 'docker',
                ...config.jobConfig.config,
            };
            const configJson = JSON.stringify(containerConfig);
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
            ];
            if (config.env) {
                for (const [key, value] of Object.entries(config.env)) {
                    if (key !== 'RECORDING') {
                        containerArgs.push('-e', `${key}=${value}`);
                    }
                }
            }
            containerArgs.push(config.image);
            logger_1.logger.info(`[Podman] Starting container with command: ${this.containerEngine} ${containerArgs.join(' ')}`);
            const containerProcess = (0, child_process_1.spawn)(this.containerEngine, containerArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            containerProcess.stdin.write(configJson);
            containerProcess.stdin.end();
            this.runningContainers.set(jobId, containerProcess);
            containerProcess.stdout.on('data', (data) => {
                const output = data.toString();
                if (output.includes('ERROR') || output.includes('error')) {
                    logger_1.logger.error(`[Podman:${jobId}] ${output}`);
                }
                else {
                    logger_1.logger.info(`[Podman:${jobId}] ${output}`);
                }
            });
            containerProcess.stderr.on('data', (data) => {
                logger_1.logger.error(`[Podman:${jobId}] ${data.toString()}`);
            });
            containerProcess.on('close', (code) => {
                this.runningContainers.delete(jobId);
                if (code === 0) {
                    logger_1.logger.info(`[Podman] Container for job ${jobId} completed successfully`);
                }
                else {
                    logger_1.logger.error(`[Podman] Container for job ${jobId} exited with code ${code}`);
                }
            });
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
            };
        }
        catch (error) {
            logger_1.logger.error(`[Podman] Failed to provision container:`, error);
            return {
                containerId: '',
                status: 'failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async getStatus(containerId) {
        logger_1.logger.info(`[Podman] Getting status for ${containerId}`);
        const process = this.runningContainers.get(containerId);
        if (process && !process.killed) {
            return 'running';
        }
        const recordingsPath = path.join(this.recordingsPath, containerId);
        if (fs.existsSync(recordingsPath)) {
            const files = fs.readdirSync(recordingsPath);
            const hasVideo = files.some((f) => f.endsWith('.mp4'));
            if (hasVideo) {
                return 'completed';
            }
        }
        try {
            const { stdout } = await execAsync(`${this.containerEngine} ps -a --filter "label=job-id=${containerId}" --format "{{.Status}}"`);
            if (stdout.includes('Up')) {
                return 'running';
            }
            else if (stdout.includes('Exited (0)')) {
                return 'completed';
            }
            else if (stdout.includes('Exited')) {
                return 'failed';
            }
        }
        catch (error) {
            logger_1.logger.error(`[Podman] Error checking status:`, error);
        }
        return 'unknown';
    }
    async stop(containerId) {
        logger_1.logger.info(`[Podman] Stopping container ${containerId}`);
        const process = this.runningContainers.get(containerId);
        if (process && !process.killed) {
            process.kill('SIGTERM');
            this.runningContainers.delete(containerId);
        }
        try {
            await execAsync(`${this.containerEngine} stop $(${this.containerEngine} ps -q --filter "label=job-id=${containerId}")`);
        }
        catch (error) {
            logger_1.logger.debug(`[Podman] Container ${containerId} already stopped`);
        }
    }
    async getLogs(containerId) {
        logger_1.logger.info(`[Podman] Getting logs for ${containerId}`);
        try {
            const { stdout } = await execAsync(`${this.containerEngine} logs $(${this.containerEngine} ps -aq --filter "label=job-id=${containerId}" | head -1)`);
            return stdout;
        }
        catch (error) {
            logger_1.logger.error(`[Podman] Error getting logs:`, error);
            return 'Logs not available';
        }
    }
    async cleanup(containerId) {
        logger_1.logger.info(`[Podman] Cleaning up container ${containerId}`);
        await this.stop(containerId);
        try {
            await execAsync(`${this.containerEngine} rm -f $(${this.containerEngine} ps -aq --filter "label=job-id=${containerId}")`);
        }
        catch (error) {
            logger_1.logger.debug(`[Podman] No container to remove for ${containerId}`);
        }
    }
}
exports.PodmanAdapter = PodmanAdapter;
//# sourceMappingURL=PodmanAdapter.js.map