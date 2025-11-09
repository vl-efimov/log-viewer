/**
 * LRU (Least Recently Used) Cache
 * Automatically evicts least recently used items when capacity is reached
 */

export class LRUCache<K, V> {
    private capacity: number;
    private cache: Map<K, V>;

    constructor(capacity: number) {
        this.capacity = capacity;
        this.cache = new Map();
    }

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

    has(key: K): boolean {
        return this.cache.has(key);
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }

    getCapacity(): number {
        return this.capacity;
    }

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
