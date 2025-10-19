import { openDB, DBSchema, IDBPDatabase } from 'idb';

const DB_NAME = 'log-viewer-db';
const STORE_FILE_INFO = 'fileInfo';
export const LOGS_STORE_PREFIX = 'logs_';

/**
 * File metadata stored in FileInfo table
 */
export interface FileInfo {
    id?: number; // auto-increment primary key
    name: string;
    size: number;
    format: string; // log format (empty for now, will be determined later)
    logsStoreName: string; // name of the logs table for this file
    uploadedAt: number; // timestamp
}

/**
 * Single log line entry
 */
export interface LogLine {
    id: number;
    line: string;
}

interface LogDB extends DBSchema {
    fileInfo: {
        key: number;
        value: FileInfo;
        indexes: { 'by-name': string };
    };
}

let dbVersion = 1;
let dbInstance: IDBPDatabase<LogDB> | null = null;

/**
 * Opens and returns an instance of the log-viewer-db database
 * @param forceReopen Force reopening the database (use after version upgrade)
 */
export const getLogDB = async (forceReopen = false): Promise<IDBPDatabase<LogDB>> => {
    if (dbInstance && !forceReopen) {
        return dbInstance;
    }

    if (forceReopen && dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }

    dbInstance = await openDB<LogDB>(DB_NAME, dbVersion, {
        upgrade(db) {
            // Create FileInfo store if it doesn't exist
            if (!db.objectStoreNames.contains(STORE_FILE_INFO)) {
                const fileStore = db.createObjectStore(STORE_FILE_INFO, {
                    keyPath: 'id',
                    autoIncrement: true,
                });
                fileStore.createIndex('by-name', 'name');
            }
        },
    });

    return dbInstance;
};

/**
 * Creates a new logs table for a specific file
 * @param storeName Name of the store to create
 */
const createLogsStore = async (storeName: string): Promise<void> => {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }

    dbVersion++;

    // Use untyped openDB for dynamic store creation
    const db = await openDB(DB_NAME, dbVersion, {
        upgrade(db) {
            // Create FileInfo store if needed
            if (!db.objectStoreNames.contains(STORE_FILE_INFO)) {
                const fileStore = db.createObjectStore(STORE_FILE_INFO, {
                    keyPath: 'id',
                    autoIncrement: true,
                });
                fileStore.createIndex('by-name', 'name');
            }

            // Create the new logs store dynamically
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: 'id' });
            }
        },
    });
    
    dbInstance = db as IDBPDatabase<LogDB>;
};

/**
 * Adds a new file with its logs to the database
 * @param name File name
 * @param size File size
 * @param lines Array of log lines
 * @returns File ID
 */
export const addFileWithLogs = async (
    name: string,
    size: number,
    lines: string[]
): Promise<number> => {
    // Generate unique store name for this file's logs
    const timestamp = Date.now();
    const logsStoreName = `${LOGS_STORE_PREFIX}${timestamp}`;
    
    // Create logs store for this file (this upgrades DB version and reopens connection)
    await createLogsStore(logsStoreName);
    
    // Force reopen DB to get the instance with the new store
    const db = await getLogDB(true);
    
    // Add file info
    const fileInfo: FileInfo = {
        name,
        size,
        format: '', // empty for now
        logsStoreName,
        uploadedAt: timestamp,
    };
    
    const fileId = await db.add(STORE_FILE_INFO, fileInfo);
    
    // Add logs to the file's store using fresh DB instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = db.transaction(logsStoreName as any, 'readwrite');
    for (let i = 0; i < lines.length; i++) {
        await tx.store.put({ id: i, line: lines[i] });
    }
    await tx.done;
    
    return fileId as number;
};

/**
 * Retrieves all file information entries
 */
export const getAllFiles = async (): Promise<FileInfo[]> => {
    const db = await getLogDB();
    return db.getAll(STORE_FILE_INFO);
};

/**
 * Retrieves file information by ID
 */
export const getFileInfo = async (fileId: number): Promise<FileInfo | undefined> => {
    const db = await getLogDB();
    return db.get(STORE_FILE_INFO, fileId);
};

/**
 * Retrieves all logs for a specific file
 */
export const getAllLogs = async (fileId: number): Promise<LogLine[]> => {
    const fileInfo = await getFileInfo(fileId);
    if (!fileInfo) {
        return [];
    }
    
    const db = await getLogDB();
    const tx = db.transaction(fileInfo.logsStoreName as never, 'readonly');
    return tx.objectStore(fileInfo.logsStoreName as never).getAll() as Promise<LogLine[]>;
};

/**
 * Retrieves a range of logs by indices [from, to) for a specific file
 * @param fileId File ID
 * @param from Start index (inclusive)
 * @param to End index (exclusive)
 */
export const getLogsRange = async (
    fileId: number,
    from: number,
    to: number
): Promise<LogLine[]> => {
    const fileInfo = await getFileInfo(fileId);
    if (!fileInfo) {
        return [];
    }
    
    const db = await getLogDB();
    const result: LogLine[] = [];
    const tx = db.transaction(fileInfo.logsStoreName as never, 'readonly');
    const store = tx.objectStore(fileInfo.logsStoreName as never);
    let cursor = await store.openCursor(IDBKeyRange.bound(from, to - 1));
    
    while (cursor) {
        result.push(cursor.value as LogLine);
        cursor = await cursor.continue();
    }
    
    return result;
};

/**
 * Deletes a file and its associated logs
 */
export const deleteFile = async (fileId: number): Promise<void> => {
    const fileInfo = await getFileInfo(fileId);
    if (!fileInfo) {
        return;
    }
    
    const db = await getLogDB();
    
    // Delete logs store (Note: IndexedDB doesn't support deleteObjectStore at runtime)
    // We'll just clear it and delete the file info
    const tx = db.transaction(fileInfo.logsStoreName as never, 'readwrite');
    await tx.objectStore(fileInfo.logsStoreName as never).clear();
    
    // Delete file info
    await db.delete(STORE_FILE_INFO, fileId);
};

/**
 * Clears all files and logs from the database
 */
export const clearAll = async (): Promise<void> => {
    const files = await getAllFiles();
    
    for (const file of files) {
        await deleteFile(file.id!);
    }
};
