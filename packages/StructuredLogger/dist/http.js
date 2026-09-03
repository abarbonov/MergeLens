// src/exporters/http-queue.ts
var createQueueItem = (record) => {
  let rejectDelivery;
  let resolveDelivery;
  const delivery = new Promise((resolve, reject) => {
    resolveDelivery = resolve;
    rejectDelivery = () => reject(new Error("HTTP logger delivery failed"));
  });
  if (resolveDelivery === void 0 || rejectDelivery === void 0) {
    throw new Error("HTTP logger queue initialization failed");
  }
  return {
    delivery,
    record,
    reject: rejectDelivery,
    resolve: resolveDelivery
  };
};
var createHttpQueue = (maxSize) => {
  const items = [];
  return {
    enqueue: (record) => {
      const dropped = items.length >= maxSize ? items.shift() : void 0;
      const item = createQueueItem(record);
      items.push(item);
      return {
        delivery: item.delivery,
        ...dropped === void 0 ? {} : { dropped }
      };
    },
    isEmpty: () => items.length === 0,
    rejectAll: () => {
      const pending = items.splice(0, items.length);
      pending.forEach((item) => item.reject());
    },
    size: () => items.length,
    take: (limit) => items.splice(0, limit)
  };
};

// src/core/levels.ts
var LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];
var isLogLevel = (value) => typeof value === "string" && LOG_LEVELS.includes(value);

// src/exporters/http.ts
var defaultBatchSize = 10;
var defaultFlushInterval = 1e3;
var defaultMaxQueueSize = 1e3;
var defaultTimeout = 5e3;
var isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var isPositiveInteger = (value) => typeof value === "number" && Number.isInteger(value) && value > 0;
var isNonNegativeInteger = (value) => typeof value === "number" && Number.isInteger(value) && value >= 0;
var isStringRecord = (value) => {
  if (!isRecord(value)) {
    return false;
  }
  try {
    return Object.values(value).every((item) => typeof item === "string");
  } catch {
    return false;
  }
};
var isHttpEndpoint = (value) => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};
var isHttpLogExporterOptions = (value) => {
  if (!isRecord(value)) {
    return false;
  }
  try {
    return isHttpEndpoint(value.endpoint) && (value.batchSize === void 0 || isPositiveInteger(value.batchSize)) && (value.fetch === void 0 || typeof value.fetch === "function") && (value.flushInterval === void 0 || isNonNegativeInteger(value.flushInterval)) && (value.headers === void 0 || isStringRecord(value.headers)) && (value.level === void 0 || isLogLevel(value.level)) && (value.maxQueueSize === void 0 || isPositiveInteger(value.maxQueueSize)) && (value.onDeliveryError === void 0 || typeof value.onDeliveryError === "function") && (value.timeout === void 0 || isNonNegativeInteger(value.timeout));
  } catch {
    return false;
  }
};
var getEndpointOrigin = (endpoint) => new URL(endpoint).origin;
var getStatusClass = (status) => `${Math.floor(status / 100)}xx`;
var getGlobalFetch = () => globalThis.fetch;
var reportDeliveryError = (handler, event) => {
  if (handler === void 0) {
    return;
  }
  try {
    handler(event);
  } catch {
  }
};
var httpLogExporter = (options) => {
  if (!isHttpLogExporterOptions(options)) {
    throw new Error("Invalid HTTP logger exporter options");
  }
  const fetch = options.fetch === void 0 ? getGlobalFetch() : options.fetch;
  if (typeof fetch !== "function") {
    throw new Error("Invalid HTTP logger exporter options");
  }
  const batchSize = options.batchSize ?? defaultBatchSize;
  const endpoint = options.endpoint;
  const endpointOrigin = getEndpointOrigin(endpoint);
  const flushInterval = options.flushInterval ?? defaultFlushInterval;
  const headers = {
    "content-type": "application/json",
    ...options.headers ?? {}
  };
  const queue = createHttpQueue(options.maxQueueSize ?? defaultMaxQueueSize);
  const timeout = options.timeout ?? defaultTimeout;
  let closed = false;
  let flushPromise;
  let flushTimer;
  const report = (operation, batchCount, status) => reportDeliveryError(options.onDeliveryError, {
    batchSize: batchCount,
    endpoint: endpointOrigin,
    exporter: "http",
    operation,
    queueSize: queue.size(),
    ...status === void 0 ? {} : { statusClass: getStatusClass(status) }
  });
  const clearFlushTimer = () => {
    if (flushTimer !== void 0) {
      clearTimeout(flushTimer);
      flushTimer = void 0;
    }
  };
  const sendBatch = async (records, count) => {
    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(endpoint, {
        body: JSON.stringify(records),
        headers,
        method: "POST",
        signal: controller.signal
      });
      if (!response.ok) {
        report("flush", count, response.status);
        return false;
      }
      return true;
    } catch {
      report("flush", count);
      return false;
    } finally {
      if (timeoutId !== void 0) {
        clearTimeout(timeoutId);
      }
    }
  };
  const scheduleFlush = () => {
    if (flushTimer !== void 0 || closed || queue.isEmpty()) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = void 0;
      void flush();
    }, flushInterval);
  };
  const flush = () => {
    if (flushPromise !== void 0) {
      return flushPromise;
    }
    clearFlushTimer();
    const operation = (async () => {
      while (!queue.isEmpty()) {
        const batch = queue.take(batchSize);
        const delivered = await sendBatch(
          batch.map((item) => item.record),
          batch.length
        );
        if (delivered) {
          batch.forEach((item) => item.resolve());
        } else {
          batch.forEach((item) => item.reject());
        }
      }
    })();
    flushPromise = operation;
    void operation.finally(() => {
      if (flushPromise === operation) {
        flushPromise = void 0;
      }
    });
    return operation;
  };
  return {
    close: async () => {
      closed = true;
      clearFlushTimer();
      await flush();
      queue.rejectAll();
    },
    export: (record) => {
      if (closed) {
        return Promise.reject(new Error("HTTP logger exporter is closed"));
      }
      const { delivery, dropped } = queue.enqueue(record);
      if (dropped !== void 0) {
        dropped.reject();
        report("enqueue", 1);
      }
      if (queue.size() >= batchSize) {
        void flush();
      } else {
        scheduleFlush();
      }
      return delivery;
    },
    flush,
    level: options.level,
    name: "http"
  };
};

export { httpLogExporter };
//# sourceMappingURL=http.js.map
//# sourceMappingURL=http.js.map