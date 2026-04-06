import type { LogFilters, DateRangeFilter, TextFilter } from '../types/filters';
import type { HistogramLine, LargeFileAggregateStats } from './histogramSampling';

const DB_NAME = 'log_viewer';
const DB_VERSION = 2;
const STORE_SESSIONS = 'sessions';
const STORE_LINES = 'lines';
const STORE_FIELD_INDEX = 'fieldIndex';
const STORE_STATS = 'stats';

const MAX_FILTER_LINES_DEFAULT = 200_000;
const MIN_TIMESTAMP_MS = -8640000000000000;
const MAX_TIMESTAMP_MS = 8640000000000000;

export type LogSessionRecord = {
    sessionId: string;
    fileName: string;
    fileSize: number;
    lastModified: number;
    formatId: string;
    createdAt: number;
    lastOpenedAt: number;
    isIndexed: boolean;
    lineCount: number;
    previewText: string;
};

export type LogLineRecord = {
    sessionId: string;
    lineNumber: number;
    raw: string;
    parsed: boolean;
    fields: Record<string, string>;
    timestampMs: number | null;
    groupId: number;
    isContinuation: boolean;
};


export type LogStatsRecord = {
    sessionId: string;
    kind: 'dashboard';
    stats: LargeFileAggregateStats;
    sampledLines: HistogramLine[];
    updatedAt: number;
};

export type FilteredLinesResult = {
    totalMatches: number;
    lines: Array<{ lineNumber: number; raw: string }>;
};

let dbPromise: Promise<IDBDatabase> | null = null;

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const transactionDone = (tx: IDBTransaction): Promise<void> => {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'));
    });
};

const openLogDb = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;

            if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
                const store = db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' });
                store.createIndex('by_lastOpenedAt', 'lastOpenedAt', { unique: false });
            }

            if (!db.objectStoreNames.contains(STORE_LINES)) {
                const store = db.createObjectStore(STORE_LINES, { keyPath: ['sessionId', 'lineNumber'] });
                store.createIndex('by_session', 'sessionId', { unique: false });
                store.createIndex('by_session_timestamp', ['sessionId', 'timestampMs'], { unique: false });
                store.createIndex('by_session_group', ['sessionId', 'groupId'], { unique: false });
            }

            if (db.objectStoreNames.contains(STORE_FIELD_INDEX)) {
                db.deleteObjectStore(STORE_FIELD_INDEX);
            }

            if (!db.objectStoreNames.contains(STORE_STATS)) {
                const store = db.createObjectStore(STORE_STATS, { keyPath: ['sessionId', 'kind'] });
                store.createIndex('by_session', 'sessionId', { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const getLogDb = async (): Promise<IDBDatabase> => {
    if (!dbPromise) {
        dbPromise = openLogDb();
    }
    return dbPromise;
};

export const deleteAllLogData = async (): Promise<void> => {
    dbPromise = null;
    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve();
    });
};

export const createLogSessionId = (): string => {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

export const upsertSession = async (session: LogSessionRecord): Promise<void> => {
    const db = await getLogDb();
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).put(session);
    await transactionDone(tx);
};

export const getSession = async (sessionId: string): Promise<LogSessionRecord | null> => {
    const db = await getLogDb();
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const store = tx.objectStore(STORE_SESSIONS);
    const result = await requestToPromise<LogSessionRecord | undefined>(store.get(sessionId));
    await transactionDone(tx);
    return result ?? null;
};

export const touchSession = async (sessionId: string): Promise<void> => {
    const db = await getLogDb();
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);
    const session = await requestToPromise<LogSessionRecord | undefined>(store.get(sessionId));
    if (session) {
        session.lastOpenedAt = Date.now();
        store.put(session);
    }
    await transactionDone(tx);
};

export const getLastSession = async (): Promise<LogSessionRecord | null> => {
    const db = await getLogDb();
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const store = tx.objectStore(STORE_SESSIONS);
    const index = store.index('by_lastOpenedAt');

    const result = await new Promise<LogSessionRecord | null>((resolve, reject) => {
        const request = index.openCursor(null, 'prev');
        request.onsuccess = () => {
            const cursor = request.result;
            resolve(cursor ? (cursor.value as LogSessionRecord) : null);
        };
        request.onerror = () => reject(request.error);
    });

    await transactionDone(tx);
    return result;
};

const deleteByIndex = async (
    db: IDBDatabase,
    storeName: string,
    indexName: string,
    range: IDBKeyRange
): Promise<void> => {
    const tx = db.transaction(storeName, 'readwrite');
    const index = tx.objectStore(storeName).index(indexName);

    await new Promise<void>((resolve, reject) => {
        const request = index.openCursor(range);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }
            cursor.delete();
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
    });

    await transactionDone(tx);
};

export const deleteSessionData = async (sessionId: string): Promise<void> => {
    const db = await getLogDb();

    const range = IDBKeyRange.only(sessionId);
    await deleteByIndex(db, STORE_LINES, 'by_session', range);
    await deleteByIndex(db, STORE_STATS, 'by_session', range);

    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).delete(sessionId);
    await transactionDone(tx);
};

export const putLineBatch = async (lines: LogLineRecord[]): Promise<void> => {
    if (lines.length === 0) return;

    const db = await getLogDb();
    const tx = db.transaction(STORE_LINES, 'readwrite');
    const lineStore = tx.objectStore(STORE_LINES);

    for (const line of lines) {
        lineStore.put(line);
    }

    await transactionDone(tx);
};

export const saveDashboardSnapshot = async (sessionId: string, snapshot: LogStatsRecord): Promise<void> => {
    const db = await getLogDb();
    const tx = db.transaction(STORE_STATS, 'readwrite');
    tx.objectStore(STORE_STATS).put({ ...snapshot, sessionId, kind: 'dashboard' });
    await transactionDone(tx);
};

export const getDashboardSnapshot = async (sessionId: string): Promise<LogStatsRecord | null> => {
    const db = await getLogDb();
    const tx = db.transaction(STORE_STATS, 'readonly');
    const store = tx.objectStore(STORE_STATS);
    const result = await requestToPromise<LogStatsRecord | undefined>(store.get([sessionId, 'dashboard']));
    await transactionDone(tx);
    return result ?? null;
};

const isDateRangeFilter = (value: unknown): value is DateRangeFilter => {
    return Boolean(value && typeof value === 'object' && ('start' in value || 'end' in value));
};

const isTextFilter = (value: unknown): value is TextFilter => {
    return Boolean(value && typeof value === 'object' && 'value' in value);
};

const isEnumFilter = (value: unknown): value is string[] => {
    return Array.isArray(value);
};

const normalizeFilterValue = (value: string): string => {
    return value.trim().toUpperCase();
};

const collectLineNumbersByTimestamp = async (
    sessionId: string,
    start: number | null,
    end: number | null
): Promise<Set<number>> => {
    const db = await getLogDb();
    const tx = db.transaction(STORE_LINES, 'readonly');
    const index = tx.objectStore(STORE_LINES).index('by_session_timestamp');

    const lower = start ?? MIN_TIMESTAMP_MS;
    const upper = end ?? MAX_TIMESTAMP_MS;
    const range = IDBKeyRange.bound([sessionId, lower], [sessionId, upper]);

    const result = await new Promise<Set<number>>((resolve, reject) => {
        const lineNumbers = new Set<number>();
        const request = index.openCursor(range);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve(lineNumbers);
                return;
            }
            const value = cursor.value as LogLineRecord;
            lineNumbers.add(value.lineNumber);
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
    });

    await transactionDone(tx);
    return result;
};

const intersectSets = (left: Set<number>, right: Set<number>): Set<number> => {
    if (left.size > right.size) {
        return intersectSets(right, left);
    }
    const result = new Set<number>();
    for (const value of left) {
        if (right.has(value)) {
            result.add(value);
        }
    }
    return result;
};

const fetchLineRecords = async (sessionId: string, lineNumbers: number[]): Promise<LogLineRecord[]> => {
    if (lineNumbers.length === 0) return [];
    const db = await getLogDb();
    const tx = db.transaction(STORE_LINES, 'readonly');
    const store = tx.objectStore(STORE_LINES);

    const records: LogLineRecord[] = [];
    await Promise.all(
        lineNumbers.map(async (lineNumber) => {
            const record = await requestToPromise<LogLineRecord | undefined>(store.get([sessionId, lineNumber]));
            if (record) {
                records.push(record);
            }
        })
    );

    await transactionDone(tx);
    return records;
};

const fetchLinesByGroupIds = async (sessionId: string, groupIds: number[]): Promise<LogLineRecord[]> => {
    if (groupIds.length === 0) return [];
    const db = await getLogDb();
    const tx = db.transaction(STORE_LINES, 'readonly');
    const index = tx.objectStore(STORE_LINES).index('by_session_group');

    const records: LogLineRecord[] = [];
    for (const groupId of groupIds) {
        const range = IDBKeyRange.only([sessionId, groupId]);
        await new Promise<void>((resolve, reject) => {
            const request = index.openCursor(range);
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve();
                    return;
                }
                records.push(cursor.value as LogLineRecord);
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });
    }

    await transactionDone(tx);
    return records;
};

const matchesTextFilters = (record: LogLineRecord, textFilters: Array<[string, TextFilter]>): boolean => {
    if (textFilters.length === 0) return true;
    for (const [field, filter] of textFilters) {
        const value = record.fields[field];
        if (!value) return false;
        const searchTerm = filter.value.toLowerCase();
        if (!value.toLowerCase().includes(searchTerm)) {
            return false;
        }
    }
    return true;
};

const matchesEnumFilters = (record: LogLineRecord, enumFilters: Array<[string, string[]]>): boolean => {
    if (enumFilters.length === 0) return true;
    for (const [field, values] of enumFilters) {
        const value = record.fields[field];
        if (!value) return false;
        const normalized = normalizeFilterValue(value);
        if (!values.includes(normalized)) {
            return false;
        }
    }
    return true;
};

const matchesDateRange = (record: LogLineRecord, startMs: number | null, endMs: number | null): boolean => {
    if (startMs === null && endMs === null) return true;
    if (record.timestampMs === null) return false;
    if (startMs !== null && record.timestampMs < startMs) return false;
    if (endMs !== null && record.timestampMs > endMs) return false;
    return true;
};

export const queryFilteredLines = async (
    sessionId: string,
    filters: LogFilters,
    options: { limit?: number } = {}
): Promise<FilteredLinesResult> => {
    const limit = options.limit ?? MAX_FILTER_LINES_DEFAULT;
    const entries = Object.entries(filters).filter(([, value]) => {
        if (!value) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (isTextFilter(value)) return Boolean(value.value);
        if (isDateRangeFilter(value)) return Boolean(value.start || value.end);
        return false;
    });

    if (entries.length === 0) {
        return { totalMatches: 0, lines: [] };
    }

    let candidateLines: Set<number> | null = null;
    const textFilters: Array<[string, TextFilter]> = [];
    const enumFilters: Array<[string, string[]]> = [];
    let rangeStart: number | null = null;
    let rangeEnd: number | null = null;

    for (const [field, value] of entries) {
        if (isEnumFilter(value)) {
            const normalized = value.map((item) => normalizeFilterValue(item));
            enumFilters.push([field, normalized]);
        } else if (isDateRangeFilter(value)) {
            const startMs = value.start ? value.start.getTime() : null;
            const endMs = value.end ? value.end.getTime() : null;
            if (startMs !== null) {
                rangeStart = rangeStart === null ? startMs : Math.max(rangeStart, startMs);
            }
            if (endMs !== null) {
                rangeEnd = rangeEnd === null ? endMs : Math.min(rangeEnd, endMs);
            }
        } else if (isTextFilter(value)) {
            if (value.value) {
                textFilters.push([field, value]);
            }
        }
    }

    if (rangeStart !== null || rangeEnd !== null) {
        const matches = await collectLineNumbersByTimestamp(sessionId, rangeStart, rangeEnd);
        candidateLines = candidateLines ? intersectSets(candidateLines, matches) : matches;
    }

    if (!candidateLines) {
        // Scan all lines.
        const db = await getLogDb();
        const tx = db.transaction(STORE_LINES, 'readonly');
        const index = tx.objectStore(STORE_LINES).index('by_session');

        const matchedGroupIds = new Set<number>();
        const matchedLines: LogLineRecord[] = [];

        await new Promise<void>((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(sessionId));
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve();
                    return;
                }
                const record = cursor.value as LogLineRecord;
                if (
                    record.parsed
                    && matchesDateRange(record, rangeStart, rangeEnd)
                    && matchesEnumFilters(record, enumFilters)
                    && matchesTextFilters(record, textFilters)
                ) {
                    matchedGroupIds.add(record.groupId);
                    matchedLines.push(record);
                }
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });

        await transactionDone(tx);

        const groupLines = await fetchLinesByGroupIds(sessionId, Array.from(matchedGroupIds));
        const all = [...matchedLines, ...groupLines];
        const unique = new Map<number, LogLineRecord>();
        for (const record of all) {
            unique.set(record.lineNumber, record);
        }

        const sorted = Array.from(unique.values()).sort((a, b) => a.lineNumber - b.lineNumber);
        return {
            totalMatches: sorted.length,
            lines: sorted.slice(0, limit).map((record) => ({ lineNumber: record.lineNumber, raw: record.raw })),
        };
    }

    const candidateArray = Array.from(candidateLines).sort((a, b) => a - b);
    const candidateRecords = await fetchLineRecords(sessionId, candidateArray);

    const matchedGroupIds = new Set<number>();
    const parsedMatches: LogLineRecord[] = [];

    for (const record of candidateRecords) {
        if (!record.parsed) {
            continue;
        }
        if (!matchesDateRange(record, rangeStart, rangeEnd)) {
            continue;
        }
        if (!matchesEnumFilters(record, enumFilters)) {
            continue;
        }
        if (!matchesTextFilters(record, textFilters)) {
            continue;
        }
        matchedGroupIds.add(record.groupId);
        parsedMatches.push(record);
    }

    const groupLines = await fetchLinesByGroupIds(sessionId, Array.from(matchedGroupIds));
    const all = [...parsedMatches, ...groupLines];
    const unique = new Map<number, LogLineRecord>();
    for (const record of all) {
        unique.set(record.lineNumber, record);
    }

    const sorted = Array.from(unique.values()).sort((a, b) => a.lineNumber - b.lineNumber);
    return {
        totalMatches: sorted.length,
        lines: sorted.slice(0, limit).map((record) => ({ lineNumber: record.lineNumber, raw: record.raw })),
    };
};
