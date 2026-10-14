export interface CliOptions {
    paths: string[];
    follow: boolean;
    asJson: boolean;
    level: string;
    sinceMs: number | null;
    traceId: string;
    limit: number;
    limitGiven: boolean;
    color: boolean;
    help: boolean;
    version: boolean;
}
export interface ParseArgsResult {
    options: CliOptions;
    error: string;
}
export declare const USAGE = "dsh-log \u2014\u2014 \u770B\u65E5\u5FD7\uFF08\u53EA\u8BFB\uFF09\n\n\u7528\u6CD5\uFF1A\n  dsh-log [tail] <\u76EE\u5F55...> [\u9009\u9879]\n\n  tail \u662F\u5B50\u547D\u4EE4\uFF1B\u4E3A\u4E86\u5C11\u6253\u5B57\u53EF\u4EE5\u7701\u7565\uFF08dsh-log <\u76EE\u5F55...> \u4E0E dsh-log tail <\u76EE\u5F55...> \u7B49\u4EF7\uFF09\u3002\n\n\u76EE\u5F55\u53EF\u4EE5\u662F\u300C\u67D0\u4E2A\u63D2\u4EF6\u7684\u65E5\u5FD7\u76EE\u5F55\u300D\uFF08\u91CC\u9762\u662F YYYY-MM-DD.log\uFF09\uFF0C\n\u4E5F\u53EF\u4EE5\u662F\u300C\u65E5\u5FD7\u6839\u76EE\u5F55\u300D\uFF08\u91CC\u9762\u662F logs-<pluginId>/\uFF09\uFF0C\u4E24\u79CD\u90FD\u8BA4\u3002\n\n\u9009\u9879\uFF1A\n  -f, --follow          \u8DDF\u7740\u770B\uFF1A\u5148\u663E\u793A\u6700\u540E N \u884C\uFF0C\u7136\u540E\u7B49\u65B0\u884C\uFF08\u9ED8\u8BA4 N=20\uFF09\n  -n, --limit <N>       \u663E\u793A\u6700\u540E N \u884C\uFF08\u9ED8\u8BA4 200\uFF1B--follow \u9ED8\u8BA4 20\uFF09\n      --level <\u7EA7\u522B>    \u53EA\u663E\u793A\u8BE5\u7EA7\u522B\u53CA\u4EE5\u4E0A\uFF08error | warn | info | debug\uFF09\n      --since <\u65F6\u957F>    \u53EA\u663E\u793A\u8FD9\u4E2A\u65F6\u95F4\u4E4B\u540E\u7684\uFF0830s | 5m | 2h | 3d | ISO \u65F6\u95F4\uFF09\n      --trace <traceId> \u53EA\u663E\u793A\u8FD9\u4E00\u6B21\u8BF7\u6C42\u94FE\u8DEF\uFF08\u6309 fields.traceId\uFF09\n      --json            \u8F93\u51FA\u539F\u59CB JSON \u884C\uFF08\u7ED9 jq/\u811A\u672C\u7528\uFF0C\u4E0D\u505A\u6E32\u67D3\uFF09\n      --no-color        \u4E0D\u989C\u8272\uFF08\u9ED8\u8BA4\u53EA\u5728\u7EC8\u7AEF\u91CC\u4E0A\u8272\uFF1BNO_COLOR=1 \u540C\u6548\uFF09\n  -h, --help            \u663E\u793A\u8FD9\u6BB5\u5E2E\u52A9\n  -v, --version         \u663E\u793A\u7248\u672C\u53F7\n\n\u4F8B\u5B50\uFF1A\n  dsh-log tail ./logs-my-plugin -f\n  dsh-log tail ./logs --since 1h --level error\n  dsh-log tail ./logs --trace 80670256ab1237b7\n  dsh-log tail ./logs --json | jq 'select(.level==\"error\") | .event'\n\n\u8BFB\u6CD5\uFF1A\u4E00\u884C\u4E00\u6761\uFF0C\u683C\u5F0F\u662F\n  <\u65F6\u95F4> <\u7EA7\u522B> <\u4E8B\u4EF6\u540D> <message>  (\u5176\u4F59\u5B57\u6BB5 k=v)\n\u5176\u4E2D message \u662F\u5199\u65E5\u5FD7\u65F6\u653E\u8FDB fields.message \u7684\u90A3\u53E5\u4EBA\u8BDD\uFF1B\u6CA1\u6709\u5B83\u5C31\u53EA\u6709\u4E8B\u4EF6\u540D\u4E0E\u5B57\u6BB5\u3002\n\n\u53EA\u8BFB\u627F\u8BFA\uFF1A\u672C\u547D\u4EE4\u4E0D\u5199\u3001\u4E0D\u6539\u3001\u4E0D\u5220\u4EFB\u4F55\u6587\u4EF6\uFF08\u5305\u62EC\u4E0D\u5199\u7F13\u5B58\u4E0E\u72B6\u6001\uFF09\u3002";
export declare function parseDuration(text: string, nowMs: number): number | null;
/** argv → 选项。纯函数：同样的输入永远同样的输出（`nowMs` 只为 `--since` 的绝对时间换算）。 */
export declare function parseArgs(argv: readonly string[], nowMs?: number): ParseArgsResult;
