import type { LogQueryAggregateResult, LogQueryArgs, LogQuerySource } from './types.js';
export declare function aggregateLogQuery(requester: string, sources: readonly LogQuerySource[], grants: readonly string[] | null | undefined, args?: LogQueryArgs | null): Promise<LogQueryAggregateResult>;
