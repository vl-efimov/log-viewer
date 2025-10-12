import { openDB, DBSchema } from 'idb';

interface LogDB extends DBSchema {
    logs: {
        key: number;
        value: { id: number; line: string };
        indexes: { 'by-id': number };
    };
}

export const getLogDB = async () => {
    return openDB<LogDB>('log-viewer-db', 1, {
        upgrade (db) {
            if (!db.objectStoreNames.contains('logs')) {
                const store = db.createObjectStore('logs', { keyPath: 'id' });
                store.createIndex('by-id', 'id');
            }
        },
    });
};

export const clearLogs = async () => {
    const db = await getLogDB();
    await db.clear('logs');
};

export const addLogs = async (lines: string[]) => {
    const db = await getLogDB();
    const tx = db.transaction('logs', 'readwrite');
    for (let i = 0; i < lines.length; i++) {
        await tx.store.put({ id: i, line: lines[i] });
    }
    await tx.done;
};

export const getAllLogs = async () => {
    const db = await getLogDB();
    return db.getAll('logs');
};

export const getLogsRange = async (from: number, to: number) => {
    const db = await getLogDB();
    const result: { id: number; line: string }[] = [];
    let cursor = await db.transaction('logs').store.openCursor(IDBKeyRange.bound(from, to - 1));
    while (cursor) {
        result.push(cursor.value);
        cursor = await cursor.continue();
    }
    return result;
};
