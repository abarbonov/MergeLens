import { h as LogContext, i as LogData, j as LoggerOptions, S as StructuredLogger, C as ConsoleLogExporterOptions, L as LogRecord, a as LogLevel, k as SerializedError, R as RuntimeInfo, l as RedactionOptions } from './options-DCdrHqMN.js';
export { m as ConsoleLogFormat, n as ConsoleLogWriter, D as DeliveryMode, E as ExporterErrorEvent, o as ExporterErrorHandler, p as ExporterOperation, q as LogExporter, r as LogExporterFunction, s as LogExporterInput, t as LogMethod, M as MaskStrategy, P as PartialMaskOptions, u as RedactionMode, v as RedactionPreset, w as RedactionRule, x as RedactionUrlOptions } from './options-DCdrHqMN.js';
export { SupportedRuntime } from './types.js';

declare const normalizeLogData: (value: unknown) => LogData | undefined;
declare const mergeLogContext: (parent?: LogContext, child?: LogContext) => {
    [x: string]: unknown;
};

declare const createLogger: (options?: LoggerOptions) => StructuredLogger;

declare const createRecordId: () => string;

declare const consoleLogExporter: (options?: ConsoleLogExporterOptions) => {
    export: (record: LogRecord) => void;
    level: LogLevel | undefined;
    name: string;
};

declare const LOG_LEVELS: readonly ["trace", "debug", "info", "warn", "error", "fatal"];
declare const isLogLevel: (value: unknown) => value is LogLevel;
declare const getLogLevelRank: (level: LogLevel) => number;
declare const isLogLevelEnabled: (level: LogLevel, minimumLevel: LogLevel) => boolean;

interface CreateLogRecordOptions {
    level: LogLevel;
    message: string;
    loggerName?: string;
    data?: LogData;
    error?: SerializedError;
    context?: LogContext;
    runtime?: RuntimeInfo;
    traceId?: string;
    id?: string;
    timestamp?: number;
}
declare const createLogRecord: (options: CreateLogRecordOptions) => LogRecord;

declare const redactLogRecord: (record: LogRecord, options?: RedactionOptions) => LogRecord;

declare const detectRuntime: () => {
    type: string;
    version?: undefined;
} | {
    type: string;
    version: string;
};
declare const getRuntimeType: () => string;

interface SanitizeOptions {
    circularValue?: string;
    maxArrayLength?: number;
    maxDepth?: number;
    maxStringLength?: number;
    replacement?: string;
}

declare const serializeError: (value: unknown, options?: SanitizeOptions) => SerializedError;

export { ConsoleLogExporterOptions, type CreateLogRecordOptions, LOG_LEVELS, LogContext, LogData, LogLevel, LogRecord, LoggerOptions, RedactionOptions, RuntimeInfo, SerializedError, StructuredLogger, consoleLogExporter, createLogRecord, createLogger, createRecordId, detectRuntime, getLogLevelRank, getRuntimeType, isLogLevel, isLogLevelEnabled, mergeLogContext, normalizeLogData, redactLogRecord, serializeError };
