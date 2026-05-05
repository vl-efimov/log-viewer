/**
 * LRU (Least Recently Used) Cache
 * Automatically evicts least recently used items when capacity is reached
 */

/**
 * LRU cache with bounded capacity and eviction of least-recently used entries.
 */
export class LRUCache<K, V> {
    private capacity: number;
    private cache: Map<K, V>;

    /**
     * Create a cache with the specified maximum capacity.
     */
    constructor(capacity: number) {
        this.capacity = capacity;
        this.cache = new Map();
    }

    /**
     * Get a value and mark it as recently used.
     */
    get(key: K): V | undefined {
        if (!this.cache.has(key)) {
            return undefined;
        }

        // Move to end (mark as recently used)
        const value = this.cache.get(key)!;
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    /**
     * Set a value and evict the least-recently used entry if needed.
     */
    set(key: K, value: V): void {
        // If key exists, delete it first (will re-add at end)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Add new entry
        this.cache.set(key, value);

        // Evict oldest if over capacity
        if (this.cache.size > this.capacity) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
    }

    /**
     * Check whether a key exists in the cache.
     */
    has(key: K): boolean {
        return this.cache.has(key);
    }

    /**
     * Remove all entries from the cache.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Return the current number of cached entries.
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Return the configured cache capacity.
     */
    getCapacity(): number {
        return this.capacity;
    }

    /**
     * Update cache capacity and evict excess entries.
     */
    setCapacity(newCapacity: number): void {
        this.capacity = newCapacity;
        
        // Evict oldest entries if over new capacity
        while (this.cache.size > this.capacity) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
    }
}
