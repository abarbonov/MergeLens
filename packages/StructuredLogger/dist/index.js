import { sha256 as sha256$1 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// src/core/context.ts
var unsafeKeys = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var isPlainData = (value) => {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
var copySafeProperties = (source) => {
  const result = {};
  for (const key of Object.keys(source)) {
    if (!unsafeKeys.has(key)) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: source[key],
        writable: true
      });
    }
  }
  return result;
};
var normalizeLogData = (value) => isPlainData(value) ? copySafeProperties(value) : void 0;
var mergeLogContext = (parent = {}, child = {}) => {
  const normalizedParent = normalizeLogData(parent) ?? {};
  const normalizedChild = normalizeLogData(child) ?? {};
  return {
    ...normalizedParent,
    ...normalizedChild
  };
};

// src/core/levels.ts
var LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];
var logLevelRanks = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5
};
var isLogLevel = (value) => typeof value === "string" && LOG_LEVELS.includes(value);
var getLogLevelRank = (level) => logLevelRanks[level];
var isLogLevelEnabled = (level, minimumLevel) => getLogLevelRank(level) >= getLogLevelRank(minimumLevel);

// src/core/dispatcher.ts
var createFallbackExporterError = () => ({
  name: "Error",
  message: "********"
});
var getExporterName = (exporter) => {
  if (typeof exporter === "function") {
    return exporter.name || "anonymous";
  }
  return typeof exporter.name === "string" && exporter.name.length > 0 ? exporter.name : "anonymous";
};
var normalizeExporter = (exporter) => {
  if (typeof exporter === "function") {
    return {
      export: exporter,
      name: getExporterName(exporter)
    };
  }
  const close = exporter.close;
  const exportRecord = exporter.export;
  const flush = exporter.flush;
  return {
    close: close === void 0 ? void 0 : () => close.call(exporter),
    export: (record) => exportRecord.call(exporter, record),
    flush: flush === void 0 ? void 0 : () => flush.call(exporter),
    level: exporter.level,
    name: getExporterName(exporter)
  };
};
var reportExporterError = (handler, exporter, operation, recordId) => {
  if (handler === void 0) {
    return;
  }
  try {
    Promise.resolve(
      handler({
        error: createFallbackExporterError(),
        exporter: exporter.name,
        operation,
        ...recordId === void 0 ? {} : { recordId }
      })
    ).catch(() => void 0);
  } catch {
  }
};
var runLifecycleOperation = async (exporters, operation, onExporterError) => {
  const targets = exporters.filter((exporter) => exporter[operation] !== void 0);
  const results = await Promise.allSettled(
    targets.map((exporter) => Promise.resolve().then(() => exporter[operation]?.()))
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      reportExporterError(onExporterError, targets[index], operation);
    }
  });
};
var dispatchRecord = async (record, exporters, onExporterError) => {
  const targets = exporters.filter(
    (exporter) => exporter.level === void 0 || isLogLevelEnabled(record.level, exporter.level)
  );
  const results = await Promise.allSettled(
    targets.map((exporter) => Promise.resolve().then(() => exporter.export(record)))
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      reportExporterError(onExporterError, targets[index], "export", record.id);
    }
  });
};
var flushExporters = (exporters, onExporterError) => runLifecycleOperation(exporters, "flush", onExporterError);
var closeExporters = (exporters, onExporterError) => runLifecycleOperation(exporters, "close", onExporterError);

// src/core/lifecycle.ts
var createLoggerLifecycle = (exporters, onExporterError) => {
  let closed = false;
  let closePromise;
  let flushPromise;
  const pendingDeliveries = /* @__PURE__ */ new Set();
  const trackDelivery = (delivery) => {
    pendingDeliveries.add(delivery);
    void delivery.then(
      () => pendingDeliveries.delete(delivery),
      () => pendingDeliveries.delete(delivery)
    );
  };
  const startFlush = () => {
    if (flushPromise !== void 0) {
      return flushPromise;
    }
    const operation = flushExporters(exporters, onExporterError);
    flushPromise = operation;
    void operation.then(
      () => {
        if (flushPromise === operation) {
          flushPromise = void 0;
        }
      },
      () => {
        if (flushPromise === operation) {
          flushPromise = void 0;
        }
      }
    );
    return operation;
  };
  const flush = () => {
    if (closePromise !== void 0) {
      return closePromise;
    }
    return startFlush();
  };
  const close = () => {
    if (closePromise !== void 0) {
      return closePromise;
    }
    closed = true;
    closePromise = (async () => {
      await Promise.allSettled([...pendingDeliveries]);
      await startFlush();
      await closeExporters(exporters, onExporterError);
    })();
    return closePromise;
  };
  return {
    close,
    flush,
    isClosed: () => closed,
    trackDelivery
  };
};

// src/core/redact-paths.ts
var splitRedactionPath = (path) => path.split(".").map((segment) => segment.trim()).filter(Boolean);
var matchesRedactionPath = (pattern, path) => {
  const patternSegments = splitRedactionPath(pattern);
  const matches = (patternIndex, pathIndex) => {
    const segment = patternSegments[patternIndex];
    if (segment === void 0) {
      return pathIndex === path.length;
    }
    if (segment === "**") {
      return matches(patternIndex + 1, pathIndex) || pathIndex < path.length && matches(patternIndex, pathIndex + 1);
    }
    return pathIndex < path.length && (segment === "*" || segment === path[pathIndex]) && matches(patternIndex + 1, pathIndex + 1);
  };
  return matches(0, 0);
};

// src/core/sanitize.ts
var DEFAULT_REDACTION_MASK = "********";
var defaultOptions = {
  circularValue: DEFAULT_REDACTION_MASK,
  maxArrayLength: 100,
  maxDepth: 10,
  maxStringLength: 1e4,
  replacement: DEFAULT_REDACTION_MASK
};
var isPlainObject = (value) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
var limitString = (value, maxLength) => value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
var sanitizeValue = (value, options = {}) => {
  const resolved = { ...defaultOptions, ...options };
  const seen = /* @__PURE__ */ new WeakSet();
  const sanitize = (current, depth) => {
    if (typeof current === "string") {
      return limitString(current, resolved.maxStringLength);
    }
    if (current === null || typeof current === "boolean" || typeof current === "number" || typeof current === "undefined") {
      return current;
    }
    if (typeof current === "bigint") {
      return current.toString();
    }
    if (typeof current === "symbol" || typeof current === "function") {
      return resolved.replacement;
    }
    if (depth >= resolved.maxDepth || typeof current !== "object") {
      return resolved.replacement;
    }
    if (seen.has(current)) {
      return resolved.circularValue;
    }
    seen.add(current);
    try {
      if (current instanceof Date) {
        return Number.isNaN(current.valueOf()) ? resolved.replacement : current.toISOString();
      }
      if (Array.isArray(current)) {
        return current.slice(0, resolved.maxArrayLength).map((item) => sanitize(item, depth + 1));
      }
      if (!isPlainObject(current)) {
        return resolved.replacement;
      }
      const result = {};
      for (const key of Object.keys(current)) {
        if (key !== "__proto__" && key !== "constructor" && key !== "prototype") {
          Object.defineProperty(result, key, {
            configurable: true,
            enumerable: true,
            value: sanitize(current[key], depth + 1),
            writable: true
          });
        }
      }
      return result;
    } catch {
      return resolved.replacement;
    } finally {
      seen.delete(current);
    }
  };
  return sanitize(value, 0);
};

// src/core/redact.ts
var removed = /* @__PURE__ */ Symbol("removed");
var recordMetadataRoots = /* @__PURE__ */ new Set(["id", "timestamp", "level", "logger", "runtime", "traceId"]);
var defaultSensitiveKeys = [
  "password",
  "passwd",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "secret",
  "clientsecret",
  "privatekey"
];
var presetKeys = {
  credentials: ["authorization", "cookie", "password", "username"],
  "financial-data": ["accountnumber", "cardnumber", "cvv", "iban"],
  "personal-data": ["address", "email", "phone", "ssn"],
  secrets: defaultSensitiveKeys
};
var defaultHeaderKeys = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key"
];
var defaultQueryParams = ["token", "code", "key", "secret", "signature"];
var stringifyForHash = (value) => typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
var sha256 = (value) => bytesToHex(sha256$1(new TextEncoder().encode(value)));
var partialMask = (value, options, mask) => {
  if (typeof value !== "string") {
    return mask;
  }
  const visibleStart = Math.max(0, options?.visibleStart ?? 1);
  const visibleEnd = Math.max(0, options?.visibleEnd ?? 0);
  if (visibleStart + visibleEnd >= value.length) {
    return mask;
  }
  return `${value.slice(0, visibleStart)}${mask}${visibleEnd === 0 ? "" : value.slice(-visibleEnd)}`;
};
var redactUrl = (value, queryParams, mask) => {
  try {
    const url = new URL(value);
    if (url.username.length > 0) {
      url.username = mask;
    }
    if (url.password.length > 0) {
      url.password = mask;
    }
    for (const key of new Set(url.searchParams.keys())) {
      if (queryParams.has(key.toLowerCase())) {
        url.searchParams.set(key, mask);
      }
    }
    return url.toString();
  } catch {
    return mask;
  }
};
var resolveOptions = (options) => {
  const presetValues = (options.presets ?? []).flatMap((preset) => presetKeys[preset]);
  return {
    allowedPaths: options.allowedPaths ?? [],
    circularValue: options.circularValue ?? DEFAULT_REDACTION_MASK,
    headerKeys: new Set(
      [...defaultHeaderKeys, ...options.headers ?? []].map((key) => key.toLowerCase())
    ),
    keyNames: new Set(
      [...defaultSensitiveKeys, ...presetValues, ...options.keys ?? []].map(
        (key) => key.toLowerCase()
      )
    ),
    mask: options.defaultMask ?? DEFAULT_REDACTION_MASK,
    maxArrayLength: options.maxArrayLength ?? 100,
    maxDepth: options.maxDepth ?? 10,
    maxStringLength: options.maxStringLength ?? 1e4,
    mode: options.mode ?? "denylist",
    queryParams: new Set(
      [...defaultQueryParams, ...options.url?.queryParams ?? []].map((key) => key.toLowerCase())
    ),
    rules: [
      ...options.rules ?? [],
      ...(options.paths ?? []).map((path) => ({ path, strategy: "mask" }))
    ]
  };
};
var applyStrategy = (value, rule, mask) => {
  const strategy = rule.transform === void 0 ? rule.strategy ?? "mask" : "custom";
  try {
    if (strategy === "remove") {
      return removed;
    }
    if (strategy === "partial") {
      return partialMask(value, rule.options, mask);
    }
    if (strategy === "hash") {
      return `sha256:${sha256(stringifyForHash(value))}`;
    }
    if (strategy === "custom") {
      return rule.transform?.(value) ?? mask;
    }
    return mask;
  } catch {
    return mask;
  }
};
var redactLogRecord = (record, options = {}) => {
  const resolved = resolveOptions(options);
  const sanitized = sanitizeValue(record, {
    circularValue: resolved.circularValue,
    maxArrayLength: resolved.maxArrayLength,
    maxDepth: resolved.maxDepth,
    maxStringLength: resolved.maxStringLength,
    replacement: resolved.mask
  });
  const redact = (value, path, isHeaderValue = false) => {
    const key = path.at(-1) ?? "";
    const lowercaseKey = key.toLowerCase();
    const matchingRule = resolved.rules.find((rule) => matchesRedactionPath(rule.path, path));
    const isAllowed = resolved.allowedPaths.some((pattern) => matchesRedactionPath(pattern, path));
    if (path[0] === "error" && (lowercaseKey === "message" || lowercaseKey === "stack")) {
      return resolved.mask;
    }
    if (matchingRule !== void 0) {
      return applyStrategy(value, matchingRule, resolved.mask);
    }
    const isRecordMetadata = path.length > 0 && recordMetadataRoots.has(path[0]);
    if (resolved.mode === "allowlist" && !isAllowed && !isRecordMetadata && !Array.isArray(value) && typeof value !== "object") {
      return resolved.mask;
    }
    if (isHeaderValue || resolved.keyNames.has(lowercaseKey)) {
      return resolved.mask;
    }
    if (lowercaseKey === "url" && typeof value === "string") {
      return redactUrl(value, resolved.queryParams, resolved.mask);
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => redact(item, [...path, String(index)], isHeaderValue)).filter((item) => item !== removed);
    }
    if (value !== null && typeof value === "object") {
      const result = {};
      const parentIsHeaders = lowercaseKey === "headers";
      for (const [childKey, childValue] of Object.entries(value)) {
        const childIsHeaderValue = parentIsHeaders && resolved.headerKeys.has(childKey.toLowerCase());
        const redacted = redact(childValue, [...path, childKey], childIsHeaderValue);
        if (redacted !== removed) {
          Object.defineProperty(result, childKey, {
            configurable: true,
            enumerable: true,
            value: redacted,
            writable: true
          });
        }
      }
      return result;
    }
    return value;
  };
  return redact(sanitized, []);
};

// src/core/id.ts
var createRecordId = () => {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (placeholder) => {
    const random = Math.floor(Math.random() * 16);
    const value = placeholder === "x" ? random : random & 3 | 8;
    return value.toString(16);
  });
};

// src/core/records.ts
var createLogRecord = (options) => {
  const record = {
    id: options.id ?? createRecordId(),
    timestamp: options.timestamp ?? Date.now(),
    level: options.level,
    message: options.message,
    logger: options.loggerName === void 0 ? {} : { name: options.loggerName },
    context: mergeLogContext({}, options.context)
  };
  const data = normalizeLogData(options.data);
  if (data !== void 0) {
    record.data = data;
  }
  if (options.error !== void 0) {
    record.error = options.error;
  }
  if (options.runtime !== void 0) {
    record.runtime = options.runtime;
  }
  if (options.traceId !== void 0) {
    record.traceId = options.traceId;
  }
  return record;
};

// src/core/serialize-error.ts
var serializeError = (value, options = {}) => {
  const replacement = options.replacement ?? DEFAULT_REDACTION_MASK;
  const seen = /* @__PURE__ */ new WeakSet();
  const serialize = (error, depth) => {
    if (!(error instanceof Error) || depth >= (options.maxDepth ?? 10) || seen.has(error)) {
      return { name: "Error", message: replacement };
    }
    seen.add(error);
    try {
      const result = {
        name: typeof error.name === "string" ? error.name : "Error",
        message: typeof error.message === "string" ? sanitizeValue(error.message, options) : replacement
      };
      if (typeof error.stack === "string") {
        result.stack = sanitizeValue(error.stack, options);
      }
      const cause = error.cause;
      if (cause !== void 0) {
        result.cause = serialize(cause, depth + 1);
      }
      for (const key of Object.keys(error)) {
        if (key !== "cause" && key !== "__proto__" && key !== "constructor" && key !== "prototype") {
          const properties = error;
          const property = properties[key];
          result[key] = property instanceof Error ? serialize(property, depth + 1) : sanitizeValue(property, options);
        }
      }
      return result;
    } catch {
      return { name: "Error", message: replacement };
    } finally {
      seen.delete(error);
    }
  };
  return serialize(value, 0);
};

// src/core/create-logger.ts
var isStringArray = (value) => {
  if (!Array.isArray(value)) {
    return false;
  }
  return Array.from(value).every((item) => typeof item === "string");
};
var isNonNegativeInteger = (value) => typeof value === "number" && Number.isInteger(value) && value >= 0;
var isOptionalString = (value) => value === void 0 || typeof value === "string";
var isOptionalStringArray = (value) => value === void 0 || isStringArray(value);
var isOptionalNonNegativeInteger = (value) => value === void 0 || isNonNegativeInteger(value);
var isRedactionPreset = (value) => value === "credentials" || value === "financial-data" || value === "personal-data" || value === "secrets";
var isMaskStrategy = (value) => value === "hash" || value === "mask" || value === "partial" || value === "remove" || value === "custom";
var isRedactionMode = (value) => value === "allowlist" || value === "denylist";
var isRedactionRule = (value) => {
  if (!isPlainData(value) || typeof value.path !== "string") {
    return false;
  }
  if (value.strategy !== void 0 && !isMaskStrategy(value.strategy)) {
    return false;
  }
  if (value.transform !== void 0 && typeof value.transform !== "function") {
    return false;
  }
  if (value.options === void 0) {
    return true;
  }
  return isPlainData(value.options) && isOptionalNonNegativeInteger(value.options.visibleEnd) && isOptionalNonNegativeInteger(value.options.visibleStart);
};
var isRedactionPresetArray = (value) => {
  if (!Array.isArray(value)) {
    return false;
  }
  return Array.from(value).every(isRedactionPreset);
};
var isRedactionRuleArray = (value) => {
  if (!Array.isArray(value)) {
    return false;
  }
  return Array.from(value).every(isRedactionRule);
};
var isRedactionOptions = (value) => {
  if (!isPlainData(value)) {
    return false;
  }
  if (!isOptionalStringArray(value.allowedPaths) || !isOptionalString(value.circularValue) || !isOptionalString(value.defaultMask) || !isOptionalStringArray(value.headers) || !isOptionalStringArray(value.keys) || !isOptionalNonNegativeInteger(value.maxArrayLength) || !isOptionalNonNegativeInteger(value.maxDepth) || !isOptionalNonNegativeInteger(value.maxStringLength) || !isOptionalStringArray(value.paths)) {
    return false;
  }
  if (value.mode !== void 0 && !isRedactionMode(value.mode)) {
    return false;
  }
  if (value.presets !== void 0 && !isRedactionPresetArray(value.presets)) {
    return false;
  }
  if (value.rules !== void 0 && !isRedactionRuleArray(value.rules)) {
    return false;
  }
  return value.url === void 0 || isPlainData(value.url) && isOptionalStringArray(value.url.queryParams);
};
var isRuntimeInfo = (value) => isPlainData(value) && (value.type === "browser" || value.type === "electron" || value.type === "node" || value.type === "react-native") && isOptionalString(value.version);
var isRecord = (value) => value !== null && typeof value === "object";
var isExporterInput = (value) => {
  if (typeof value === "function") {
    return true;
  }
  return isRecord(value) && typeof value.name === "string" && typeof value.export === "function" && (value.level === void 0 || isLogLevel(value.level)) && (value.flush === void 0 || typeof value.flush === "function") && (value.close === void 0 || typeof value.close === "function");
};
var resolveExporters = (value) => {
  if (value === void 0) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid logger exporter");
  }
  const exporters = [];
  for (const exporter of value) {
    if (!isExporterInput(exporter)) {
      throw new Error("Invalid logger exporter");
    }
    exporters.push(normalizeExporter(exporter));
  }
  return exporters;
};
var resolveLoggerOptions = (options) => {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new Error("Invalid logger options");
  }
  const delivery = options.delivery === void 0 ? "background" : options.delivery;
  if (delivery !== "await" && delivery !== "background") {
    throw new Error("Invalid logger delivery mode");
  }
  const level = options.level === void 0 ? "info" : options.level;
  if (!isLogLevel(level)) {
    throw new Error("Invalid logger level");
  }
  if (options.name !== void 0 && typeof options.name !== "string") {
    throw new Error("Invalid logger name");
  }
  if (options.context !== void 0 && !isPlainData(options.context)) {
    throw new Error("Invalid logger context");
  }
  if (options.runtime !== void 0 && !isRuntimeInfo(options.runtime)) {
    throw new Error("Invalid logger runtime");
  }
  if (options.onExporterError !== void 0 && typeof options.onExporterError !== "function") {
    throw new Error("Invalid logger error handler");
  }
  const redact = options.redact === void 0 ? {} : options.redact;
  if (!isRedactionOptions(redact)) {
    throw new Error("Invalid logger redaction options");
  }
  return {
    context: mergeLogContext({}, options.context),
    delivery,
    exporters: resolveExporters(options.exporters),
    level,
    name: options.name,
    onExporterError: options.onExporterError,
    redact,
    runtime: options.runtime
  };
};
var createLoggerFromOptions = (options, lifecycle = createLoggerLifecycle(options.exporters, options.onExporterError)) => {
  const log = (level, message, data) => {
    if (lifecycle.isClosed() || !isLogLevelEnabled(level, options.level)) {
      return;
    }
    const record = redactLogRecord(
      createLogRecord({
        context: options.context,
        data: data instanceof Error ? void 0 : data,
        error: data instanceof Error ? serializeError(data) : void 0,
        level,
        loggerName: options.name,
        message,
        runtime: options.runtime
      }),
      options.redact
    );
    const delivery = dispatchRecord(record, options.exporters, options.onExporterError);
    lifecycle.trackDelivery(delivery);
    if (options.delivery === "await") {
      return delivery;
    }
  };
  return {
    child: (context) => createLoggerFromOptions(
      {
        ...options,
        context: mergeLogContext(options.context, context)
      },
      lifecycle
    ),
    close: lifecycle.close,
    debug: (message, data) => log("debug", message, data),
    error: (message, data) => log("error", message, data),
    fatal: (message, data) => log("fatal", message, data),
    flush: lifecycle.flush,
    info: (message, data) => log("info", message, data),
    trace: (message, data) => log("trace", message, data),
    warn: (message, data) => log("warn", message, data)
  };
};
var createLogger = (options = {}) => createLoggerFromOptions(resolveLoggerOptions(options));

// src/exporters/console.ts
var levelColors = {
  trace: "\x1B[90m",
  debug: "\x1B[36m",
  info: "\x1B[32m",
  warn: "\x1B[33m",
  error: "\x1B[31m",
  fatal: "\x1B[31m"
};
var colorReset = "\x1B[0m";
var consoleMethods = ["debug", "error", "info", "log", "trace", "warn"];
var isRecord2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var isConsoleLogWriter = (value) => {
  if (!isRecord2(value)) {
    return false;
  }
  try {
    return typeof value.log === "function" && consoleMethods.every(
      (method) => value[method] === void 0 || typeof value[method] === "function"
    );
  } catch {
    return false;
  }
};
var isConsoleLogExporterOptions = (value) => {
  if (!isRecord2(value)) {
    return false;
  }
  try {
    return (value.colors === void 0 || typeof value.colors === "boolean") && (value.console === void 0 || isConsoleLogWriter(value.console)) && (value.format === void 0 || value.format === "json" || value.format === "pretty") && (value.level === void 0 || isLogLevel(value.level));
  } catch {
    return false;
  }
};
var getRuntimeProcess = () => globalThis.process;
var supportsAnsiColors = () => getRuntimeProcess()?.stdout?.isTTY === true;
var formatJson = (record) => JSON.stringify(record);
var formatPretty = (record, colors) => {
  const level = record.level.toUpperCase();
  const formattedLevel = colors ? `${levelColors[record.level]}${level}${colorReset}` : level;
  const loggerName = record.logger.name === void 0 ? "" : ` [${record.logger.name}]`;
  const details = [
    Object.keys(record.context).length === 0 ? void 0 : `context=${JSON.stringify(record.context)}`,
    record.data === void 0 ? void 0 : `data=${JSON.stringify(record.data)}`,
    record.error === void 0 ? void 0 : `error=${JSON.stringify(record.error)}`
  ].filter((value) => value !== void 0);
  return `${new Date(record.timestamp).toISOString()} ${formattedLevel}${loggerName} ${record.message}${details.length === 0 ? "" : ` ${details.join(" ")}`}`;
};
var getConsoleMethod = (writer, level) => {
  const methods = {
    trace: "trace",
    debug: "debug",
    info: "info",
    warn: "warn",
    error: "error",
    fatal: "error"
  };
  return writer[methods[level]] ?? writer.log;
};
var consoleLogExporter = (options = {}) => {
  if (!isConsoleLogExporterOptions(options)) {
    throw new Error("Invalid console exporter options");
  }
  const writer = options.console === void 0 ? globalThis.console : options.console;
  if (!isConsoleLogWriter(writer)) {
    throw new Error("Invalid console exporter options");
  }
  const colors = options.colors === true && supportsAnsiColors();
  const format = options.format ?? "pretty";
  return {
    export: (record) => {
      const method = getConsoleMethod(writer, record.level);
      method.call(writer, format === "json" ? formatJson(record) : formatPretty(record, colors));
    },
    level: options.level,
    name: "console"
  };
};

// src/core/runtime.ts
var getRuntimeProcess2 = () => globalThis.process;
var detectRuntime = () => {
  const process = getRuntimeProcess2();
  if (globalThis.navigator?.product === "ReactNative") {
    return { type: "react-native" };
  }
  if (process?.versions?.electron !== void 0) {
    return {
      type: "electron",
      version: process.versions.electron
    };
  }
  if (process?.versions?.node !== void 0) {
    return {
      type: "node",
      version: process.version ?? process.versions.node
    };
  }
  return { type: "browser" };
};
var getRuntimeType = () => detectRuntime().type;

export { LOG_LEVELS, consoleLogExporter, createLogRecord, createLogger, createRecordId, detectRuntime, getLogLevelRank, getRuntimeType, isLogLevel, isLogLevelEnabled, mergeLogContext, normalizeLogData, redactLogRecord, serializeError };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map