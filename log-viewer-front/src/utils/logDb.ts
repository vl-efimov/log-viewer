import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { getLogFieldsForFormat, parseLogLine } from './logFormatFields';

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

// Parsed log line with dynamic fields
export type LogLine = { id: number } & Record<string, string>;

interface LogDB extends DBSchema {
    fileInfo: {
        key: number;
        value: FileInfo;
        indexes: { 'by-name': string };
    };
}

let dbInstance: IDBPDatabase<LogDB> | null = null;

/**
 * Opens and returns an instance of the log-viewer-db database
 * @param forceReopen Force reopening the database (use after version upgrade)
 */
export const getLogDB = async (forceReopen = false): Promise<IDBPDatabase<LogDB>> => {
    if (dbInstance && !forceReopen) return dbInstance;

    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }

    // Open DB (untyped) to inspect current version and stores
    const dbAny = await openDB(DB_NAME);

    // If fileInfo store is missing, bump version by 1 and create it
    if (!dbAny.objectStoreNames.contains(STORE_FILE_INFO)) {
        const currentVersion = dbAny.version;
        dbAny.close();
        const dbTyped = await openDB<LogDB>(DB_NAME, currentVersion + 1, {
            upgrade(upgDb) {
                if (!upgDb.objectStoreNames.contains(STORE_FILE_INFO)) {
                    const fileStore = upgDb.createObjectStore(STORE_FILE_INFO, {
                        keyPath: 'id',
                        autoIncrement: true,
                    });
                    fileStore.createIndex('by-name', 'name');
                }
            },
        });
        dbInstance = dbTyped as IDBPDatabase<LogDB>;
        return dbInstance;
    }

    dbInstance = dbAny as IDBPDatabase<LogDB>;
    return dbInstance;
};

/**
 * Creates a new logs table for a specific file
 * @param storeName Name of the store to create
 */
const createLogsStore = async (storeName: string, _fields: string[]): Promise<void> => {
    // acknowledge unused parameter
    void _fields;
    // Close existing instance so we can perform a versioned upgrade
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
    // Open DB (untyped) to learn current version
    const infoDb = await openDB(DB_NAME);
    const currentVersion = infoDb.version;
    infoDb.close();

    const newVersion = currentVersion + 1;

    const db = await openDB<LogDB>(DB_NAME, newVersion, {
        upgrade(upgDb) {
            // Ensure FileInfo store exists
            if (!upgDb.objectStoreNames.contains(STORE_FILE_INFO)) {
                const fileStore = upgDb.createObjectStore(STORE_FILE_INFO, {
                    keyPath: 'id',
                    autoIncrement: true,
                });
                fileStore.createIndex('by-name', 'name');
            }
            // Create the new logs store dynamically, with keyPath 'id'
            const idb = upgDb as unknown as IDBDatabase;
            if (!idb.objectStoreNames.contains(storeName)) {
                idb.createObjectStore(storeName, { keyPath: 'id' });
            }
        },
    });

    dbInstance = db as IDBPDatabase<LogDB>;
};

/**
 * Adds a new file with its parsed logs to the database
 * @param name File name
 * @param size File size
 * @param lines Array of log lines (raw)
 * @param format Detected log format
 * @returns File ID
 */
export const addFileWithLogs = async (
    name: string,
    size: number,
    lines: string[],
    format: string
): Promise<number> => {
    // Generate unique store name for this file's logs
    const timestamp = Date.now();
    const logsStoreName = `${LOGS_STORE_PREFIX}${timestamp}`;
    // Get fields for this format
    const fields = getLogFieldsForFormat(format);
    // Create logs store for this file (this upgrades DB version and reopens connection)
    await createLogsStore(logsStoreName, fields);
    // Force reopen DB to get the instance with the new store
    const db = await getLogDB(true);
    // Add file info
    const fileInfo: FileInfo = {
        name,
        size,
        format,
        logsStoreName,
        uploadedAt: timestamp,
    };
    const fileId = await db.add(STORE_FILE_INFO, fileInfo);
    // Add parsed logs to the file's store using fresh DB instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = db.transaction(logsStoreName as any, 'readwrite');
    for (let i = 0; i < lines.length; i++) {
        const parsed = parseLogLine(lines[i], format);
        await tx.store.put({ id: i, ...parsed });
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

    if (dbInstance) {
        try {
            dbInstance.close();
        } catch {
            // ignore
        }
        dbInstance = null;
    }

    // Open untyped DB to get current version
    const dbAny = await openDB(DB_NAME);
    const currentVersion = dbAny.version;
    dbAny.close();

    const newVersion = currentVersion + 1;

    // Perform upgrade and delete the logs store
    const db = await openDB<LogDB>(DB_NAME, newVersion, {
        upgrade(upgDb) {
            // Ensure fileInfo store exists
            if (!upgDb.objectStoreNames.contains(STORE_FILE_INFO)) {
                const fileStore = upgDb.createObjectStore(STORE_FILE_INFO, {
                    keyPath: 'id',
                    autoIncrement: true,
                });
                fileStore.createIndex('by-name', 'name');
            }
            // delete the logs store if it exists
            const idb = upgDb as unknown as IDBDatabase;
            if (idb.objectStoreNames.contains(fileInfo.logsStoreName)) {
                try {
                    idb.deleteObjectStore(fileInfo.logsStoreName);
                } catch {
                    // ignore deletion errors (shouldn't normally happen)
                }
            }
        },
    });

    // Replace cached instance
    dbInstance = db as IDBPDatabase<LogDB>;

    // Finally remove the fileInfo entry
    try {
        await db.delete(STORE_FILE_INFO, fileId);
    } catch (e) {
        console.error('Failed to delete fileInfo after dropping store', e);
    }
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
