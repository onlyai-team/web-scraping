export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function formatMs(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function emit(level: LogLevel, component: string, msg: string, data?: Record<string, unknown>) {
    if (!shouldLog(level)) return;

    const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        component,
        msg,
        ...data,
    };

    const line = JSON.stringify(entry);
    if (level === "error") {
        console.error(line);
    } else if (level === "warn") {
        console.warn(line);
    } else {
        console.log(line);
    }
}

export function createLogger(component: string) {
    return {
        debug: (msg: string, data?: Record<string, unknown>) => emit("debug", component, msg, data),
        info: (msg: string, data?: Record<string, unknown>) => emit("info", component, msg, data),
        warn: (msg: string, data?: Record<string, unknown>) => emit("warn", component, msg, data),
        error: (msg: string, data?: Record<string, unknown>) => emit("error", component, msg, data),
    };
}

export { formatMs };
