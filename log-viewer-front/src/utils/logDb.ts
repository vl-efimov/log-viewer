import { openDB, DBSchema } from 'idb';


const DB_NAME = 'log-viewer-db';
const DB_VERSION = 1;
const STORE_LOGS = 'logs';
const STORE_FILE_INFO = 'fileInfo';
const FILE_INFO_KEY = 'file';
const INDEX_BY_ID = 'by-id';


interface LogDB extends DBSchema {
    [STORE_LOGS]: {
        key: number;
        value: { id: number; line: string };
        indexes: { [INDEX_BY_ID]: number };
    };
    [STORE_FILE_INFO]: {
        key: typeof FILE_INFO_KEY;
        value: { name: string; size: number };
    };
}

/**
 * Opens and returns an instance of the log-viewer-db database
 */
export const getLogDB = async () => {
    return openDB<LogDB>(DB_NAME, DB_VERSION, {
        upgrade (db) {
            if (!db.objectStoreNames.contains(STORE_LOGS)) {
                const store = db.createObjectStore(STORE_LOGS, { keyPath: 'id' });
                store.createIndex(INDEX_BY_ID, 'id');
            }
            if (!db.objectStoreNames.contains(STORE_FILE_INFO)) {
                db.createObjectStore(STORE_FILE_INFO);
            }
        },
    });
};

/**
 * Clears all logs from IndexedDB
 */
export const clearLogs = async (): Promise<void> => {
    const db = await getLogDB();
    await db.clear(STORE_LOGS);
};

/**
 * Adds an array of log lines to IndexedDB
 * @param lines Array of log lines
 */
export const addLogs = async (lines: string[]): Promise<void> => {
    const db = await getLogDB();
    const tx = db.transaction(STORE_LOGS, 'readwrite');
    for (let i = 0; i < lines.length; i++) {
        await tx.store.put({ id: i, line: lines[i] });
    }
    await tx.done;
};

/**
 * Retrieves all logs from IndexedDB
 */
export const getAllLogs = async (): Promise<{ id: number; line: string }[]> => {
    const db = await getLogDB();
    return db.getAll(STORE_LOGS);
};

/**
 * Retrieves a range of logs by indices [from, to)
 * @param from Start index (inclusive)
 * @param to End index (exclusive)
 */
export const getLogsRange = async (from: number, to: number): Promise<{ id: number; line: string }[]> => {
    const db = await getLogDB();
    const result: { id: number; line: string }[] = [];
    let cursor = await db.transaction(STORE_LOGS).store.openCursor(IDBKeyRange.bound(from, to - 1));
    while (cursor) {
        result.push(cursor.value);
        cursor = await cursor.continue();
    }
    return result;
};

/**
 * Saves file information
 * @param name File name
 * @param size File size
 */
export const setFileInfo = async (name: string, size: number): Promise<void> => {
    const db = await getLogDB();
    await db.put(STORE_FILE_INFO, { name, size }, FILE_INFO_KEY);
};

/**
 * Retrieves file information
 */
export const getFileInfo = async (): Promise<{ name: string; size: number } | undefined> => {
    const db = await getLogDB();
    return db.get(STORE_FILE_INFO, FILE_INFO_KEY);
};

/**
 * Clears file information
 */
export const clearFileInfo = async (): Promise<void> => {
    const db = await getLogDB();
    await db.delete(STORE_FILE_INFO, FILE_INFO_KEY);
};
