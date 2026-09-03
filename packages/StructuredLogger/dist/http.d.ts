import { H as HttpLogExporterOptions, L as LogRecord, a as LogLevel } from './options-DCdrHqMN.js';
export { b as HttpDeliveryErrorEvent, c as HttpDeliveryErrorHandler, d as HttpDeliveryOperation, e as HttpFetch, f as HttpFetchRequest, g as HttpFetchResponse } from './options-DCdrHqMN.js';

declare const httpLogExporter: (options: HttpLogExporterOptions) => {
    close: () => Promise<void>;
    export: (record: LogRecord) => Promise<void>;
    flush: () => Promise<void>;
    level: LogLevel | undefined;
    name: string;
};

export { HttpLogExporterOptions, httpLogExporter };
