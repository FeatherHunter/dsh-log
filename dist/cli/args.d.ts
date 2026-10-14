export interface CliOptions {
    /** 子命令：tail（看日志，默认）或 export（交日志：目录 → 自包含摘要 + 原始行）。 */
    command: 'tail' | 'export';
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
export declare const USAGE = "dsh-log \u2014\u2014 \u770B\u65E5\u5FD7\u3001\u4EA4\u65E5\u5FD7\uFF08\u53EA\u8BFB\uFF09\n\n\u7528\u6CD5\uFF1A\n  dsh-log [tail] <\u76EE\u5F55...> [\u9009\u9879]\n  dsh-log export <\u76EE\u5F55...> [--json]\n\n  \u5B50\u547D\u4EE4\uFF1A\n    tail\uFF08\u53EF\u7701\u7565\uFF09  \u770B\u65E5\u5FD7\uFF1A\u6309\u5199\u5165\u987A\u5E8F\u6E32\u67D3\u6210\u4EBA\u8BDD\uFF0C\u53EF\u7B5B\u9009\u3001\u53EF\u8DDF\u8BFB\n    export          \u4EA4\u65E5\u5FD7\uFF1A\u4EA7\u51FA\u4E00\u4EFD**\u81EA\u5305\u542B**\u6587\u672C\uFF08\u76EE\u5F55\u6458\u8981 + \u539F\u59CB\u884C\uFF09\uFF0C\n                    \u8D34\u8FDB\u5DE5\u5355\u3001\u5F53\u9644\u4EF6\u90FD\u591F\uFF1B\u6458\u8981\u91CC\u7684 unknown \u5C31\u662F\u300C\u6CA1\u8BB0\u4E0B\u6765\u300D\uFF0C\u4E0D\u4F1A\u62FF\u4F60\u7684\u73AF\u5883\u9876\u66FF\n\n  tail \u7684\u5B50\u547D\u4EE4\u540D\u53EF\u4EE5\u7701\u7565\uFF08dsh-log <\u76EE\u5F55...> \u4E0E dsh-log tail <\u76EE\u5F55...> \u7B49\u4EF7\uFF09\u3002\n\n\u76EE\u5F55\u53EF\u4EE5\u662F\u300C\u67D0\u4E2A\u63D2\u4EF6\u7684\u65E5\u5FD7\u76EE\u5F55\u300D\uFF08\u91CC\u9762\u662F YYYY-MM-DD.log\uFF09\uFF0C\n\u4E5F\u53EF\u4EE5\u662F\u300C\u65E5\u5FD7\u6839\u76EE\u5F55\u300D\uFF08\u91CC\u9762\u662F logs-<pluginId>/\uFF09\uFF0C\u4E24\u79CD\u90FD\u8BA4\u3002\n\n\u9009\u9879\uFF08tail\uFF09\uFF1A\n  -f, --follow          \u8DDF\u7740\u770B\uFF1A\u5148\u663E\u793A\u6700\u540E N \u884C\uFF0C\u7136\u540E\u7B49\u65B0\u884C\uFF08\u9ED8\u8BA4 N=20\uFF09\n  -n, --limit <N>       \u663E\u793A\u6700\u540E N \u884C\uFF08\u9ED8\u8BA4 200\uFF1B--follow \u9ED8\u8BA4 20\uFF09\n      --level <\u7EA7\u522B>    \u53EA\u663E\u793A\u8BE5\u7EA7\u522B\u53CA\u4EE5\u4E0A\uFF08error | warn | info | debug\uFF09\n      --since <\u65F6\u957F>    \u53EA\u663E\u793A\u8FD9\u4E2A\u65F6\u95F4\u4E4B\u540E\u7684\uFF0830s | 5m | 2h | 3d | ISO \u65F6\u95F4\uFF09\n      --trace <traceId> \u53EA\u663E\u793A\u8FD9\u4E00\u6B21\u8BF7\u6C42\u94FE\u8DEF\uFF08\u6309 fields.traceId\uFF09\n      --json            \u8F93\u51FA\u539F\u59CB JSON \u884C\uFF08\u7ED9 jq/\u811A\u672C\u7528\uFF0C\u4E0D\u505A\u6E32\u67D3\uFF09\n      --no-color        \u4E0D\u989C\u8272\uFF08\u9ED8\u8BA4\u53EA\u5728\u7EC8\u7AEF\u91CC\u4E0A\u8272\uFF1BNO_COLOR=1 \u540C\u6548\uFF09\n  -h, --help            \u663E\u793A\u8FD9\u6BB5\u5E2E\u52A9\n  -v, --version         \u663E\u793A\u7248\u672C\u53F7\n\n\u9009\u9879\uFF08export\uFF09\uFF1A\n      --json            \u53EA\u8F93\u51FA\u6458\u8981\u5BF9\u8C61\uFF08\u4E00\u4E2A JSON\uFF09\uFF1B\u8981\u884C\u5C31\u7528 tail --json\n      \uFF08\u7B5B\u9009\u7C7B\u9009\u9879\u5BF9 export \u6CA1\u6709\u610F\u4E49\uFF0C\u4F20\u4E86\u4F1A\u5F53\u573A\u62A5\u9519\uFF0C\u4E0D\u9759\u9ED8\u5FFD\u7565\uFF09\n\n\u4F8B\u5B50\uFF1A\n  dsh-log tail ./logs-my-plugin -f\n  dsh-log tail ./logs --since 1h --level error\n  dsh-log tail ./logs --trace 80670256ab1237b7\n  dsh-log tail ./logs --json | jq 'select(.level==\"error\") | .event'\n  dsh-log export ./logs-my-plugin > ticket.txt\n  dsh-log export ./logs-my-plugin --json | jq .rows\n\n\u8BFB\u6CD5\uFF1A\u4E00\u884C\u4E00\u6761\uFF0C\u683C\u5F0F\u662F\n  <\u65F6\u95F4> <\u7EA7\u522B> <\u4E8B\u4EF6\u540D> <message>  (\u5176\u4F59\u5B57\u6BB5 k=v)\n\u5176\u4E2D message \u662F\u5199\u65E5\u5FD7\u65F6\u653E\u8FDB fields.message \u7684\u90A3\u53E5\u4EBA\u8BDD\uFF1B\u6CA1\u6709\u5B83\u5C31\u53EA\u6709\u4E8B\u4EF6\u540D\u4E0E\u5B57\u6BB5\u3002\n\n\u53EA\u8BFB\u627F\u8BFA\uFF1A\u672C\u547D\u4EE4\u4E0D\u5199\u3001\u4E0D\u6539\u3001\u4E0D\u5220\u4EFB\u4F55\u6587\u4EF6\uFF08\u5305\u62EC\u4E0D\u5199\u7F13\u5B58\u4E0E\u72B6\u6001\uFF09\uFF1B\u8981\u7559\u6863\u8BF7\u7528 shell \u91CD\u5B9A\u5411\u3002";
export declare function parseDuration(text: string, nowMs: number): number | null;
/** argv → 选项。纯函数：同样的输入永远同样的输出（`nowMs` 只为 `--since` 的绝对时间换算）。 */
export declare function parseArgs(argv: readonly string[], nowMs?: number): ParseArgsResult;
