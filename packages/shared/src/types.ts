// Common types shared across the monorepo
export interface BaseConfig {
  environment: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface JobConfig extends BaseConfig {
  jobId: string;
  meetingUrl: string;
  botName: string;
}
