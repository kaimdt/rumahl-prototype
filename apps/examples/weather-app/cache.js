const NodeCache = require('node-cache');

class Cache {
  constructor(ttl = 300) {
    this.cache = new NodeCache({
      stdTTL: ttl,
      checkperiod: 60,
      useClones: false
    });

    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.hits++;
      return value;
    }
    this.misses++;
    return null;
  }

  set(key, value) {
    return this.cache.set(key, value);
  }

  del(key) {
    return this.cache.del(key);
  }

  flush() {
    this.cache.flushAll();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const keys = this.cache.keys();
    return {
      keys: keys.length,
      hits: this.hits,
      misses: this.misses,
      hit_rate: this.hits + this.misses > 0
        ? Math.round((this.hits / (this.hits + this.misses)) * 100)
        : 0,
      cached_keys: keys
    };
  }
}

module.exports = Cache;
