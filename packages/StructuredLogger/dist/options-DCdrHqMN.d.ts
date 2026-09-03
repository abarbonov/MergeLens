type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type LogData = Record<string, unknown>;
type LogContext = Record<string, unknown>;
interface SerializedError {
    name: string;
    message: string;
    stack?: string;
    cause?: SerializedError;
    [key: string]: unknown;
}
interface RuntimeInfo {
    type: 'browser' | 'electron' | 'node' | 'react-native';
    version?: string;
}
interface LogRecord {
    id: string;
    timestamp: number;
    level: LogLevel;
    message: string;
    logger: {
        name?: string;
    };
    data?: LogData;
    error?: SerializedError;
    context: LogContext;
    runtime?: RuntimeInfo;
    traceId?: string;
}

interface LogExporter {
    name: string;
    level?: LogLevel;
    export: (record: LogRecord) => void | Promise<void>;
    flush?: () => void | Promise<void>;
    close?: () => void | Promise<void>;
}
type LogExporterFunction = (record: LogRecord) => void | Promise<void>;
type LogExporterInput = LogExporter | LogExporterFunction;

type LogMethod = (message: string, data?: LogData | Error) => void | Promise<void>;
interface StructuredLogger {
    trace: LogMethod;
    debug: LogMethod;
    info: LogMethod;
    warn: LogMethod;
    error: LogMethod;
    fatal: LogMethod;
    child: (context: LogContext) => StructuredLogger;
    flush: () => Promise<void>;
    close: () => Promise<void>;
}
type DeliveryMode = 'await' | 'background';
type ExporterOperation = 'close' | 'export' | 'flush';
interface ExporterErrorEvent {
    exporter: string;
    operation: ExporterOperation;
    error: SerializedError;
    recordId?: string;
}
type ExporterErrorHandler = (event: ExporterErrorEvent) => void;

type ConsoleLogFormat = 'json' | 'pretty';
interface ConsoleLogWriter {
    log: (message: string) => void;
    debug?: (message: string) => void;
    error?: (message: string) => void;
    info?: (message: string) => void;
    trace?: (message: string) => void;
    warn?: (message: string) => void;
}
interface ConsoleLogExporterOptions {
    colors?: boolean;
    console?: ConsoleLogWriter;
    format?: ConsoleLogFormat;
    level?: LogLevel;
}
interface HttpFetchRequest {
    body: string;
    headers: Readonly<Record<string, string>>;
    method: 'POST';
    signal: AbortSignal;
}
interface HttpFetchResponse {
    ok: boolean;
    status: number;
}
type HttpFetch = (endpoint: string, request: HttpFetchRequest) => Promise<HttpFetchResponse>;
type HttpDeliveryOperation = 'enqueue' | 'flush';
interface HttpDeliveryErrorEvent {
    batchSize: number;
    endpoint: string;
    exporter: 'http';
    operation: HttpDeliveryOperation;
    queueSize: number;
    statusClass?: string;
}
type HttpDeliveryErrorHandler = (event: HttpDeliveryErrorEvent) => void;
interface HttpLogExporterOptions {
    batchSize?: number;
    endpoint: string;
    fetch?: HttpFetch;
    flushInterval?: number;
    headers?: Readonly<Record<string, string>>;
    level?: LogLevel;
    maxQueueSize?: number;
    onDeliveryError?: HttpDeliveryErrorHandler;
    timeout?: number;
}
type MaskStrategy = 'hash' | 'mask' | 'partial' | 'remove' | 'custom';
type RedactionMode = 'allowlist' | 'denylist';
type RedactionPreset = 'credentials' | 'financial-data' | 'personal-data' | 'secrets';
interface PartialMaskOptions {
    visibleEnd?: number;
    visibleStart?: number;
}
interface RedactionRule {
    path: string;
    strategy?: MaskStrategy;
    options?: PartialMaskOptions;
    transform?: (value: unknown) => unknown;
}
interface RedactionUrlOptions {
    queryParams?: readonly string[];
}
interface RedactionOptions {
    allowedPaths?: readonly string[];
    circularValue?: string;
    defaultMask?: string;
    headers?: readonly string[];
    keys?: readonly string[];
    maxArrayLength?: number;
    maxDepth?: number;
    maxStringLength?: number;
    mode?: RedactionMode;
    paths?: readonly string[];
    presets?: readonly RedactionPreset[];
    rules?: readonly RedactionRule[];
    url?: RedactionUrlOptions;
}
interface LoggerOptions {
    name?: string;
    level?: LogLevel;
    context?: LogContext;
    runtime?: RuntimeInfo;
    delivery?: DeliveryMode;
    exporters?: readonly LogExporterInput[];
    onExporterError?: ExporterErrorHandler;
    redact?: RedactionOptions;
}

export type { ConsoleLogExporterOptions as C, DeliveryMode as D, ExporterErrorEvent as E, HttpLogExporterOptions as H, LogRecord as L, MaskStrategy as M, PartialMaskOptions as P, RuntimeInfo as R, StructuredLogger as S, LogLevel as a, HttpDeliveryErrorEvent as b, HttpDeliveryErrorHandler as c, HttpDeliveryOperation as d, HttpFetch as e, HttpFetchRequest as f, HttpFetchResponse as g, LogContext as h, LogData as i, LoggerOptions as j, SerializedError as k, RedactionOptions as l, ConsoleLogFormat as m, ConsoleLogWriter as n, ExporterErrorHandler as o, ExporterOperation as p, LogExporter as q, LogExporterFunction as r, LogExporterInput as s, LogMethod as t, RedactionMode as u, RedactionPreset as v, RedactionRule as w, RedactionUrlOptions as x };
