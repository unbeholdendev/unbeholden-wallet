import "fake-indexeddb/auto";

// jsdom leaves it undefined; every browser defines it.
Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
