import type { ClientQueuedRow } from './types.js';
export declare const LOG_RETRY_MAX_ATTEMPTS = 3;
export declare const LOG_RETRY_BACKOFF_MS = 500;
export declare function estimateBatchBytes(entries: ClientQueuedRow[]): number;
