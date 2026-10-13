import type { LogPhonesContext, LogQueryArgs, LogQueryResult } from './types.js';
export declare function createLogQueryHandler(ctx: LogPhonesContext): {
    handleLogQuery: (rawArgs?: LogQueryArgs | null) => Promise<LogQueryResult>;
};
