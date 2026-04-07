import { createSlice, PayloadAction } from '@reduxjs/toolkit';
// Global storage for FileSystemFileHandle and File (can't be serialized in Redux)
let globalFileHandle: FileSystemFileHandle | null = null;
let globalFileObject: File | null = null;

export const setFileHandle = (handle: FileSystemFileHandle | null) => {
    globalFileHandle = handle;
};

export const getFileHandle = (): FileSystemFileHandle | null => {
    return globalFileHandle;
};

export const setFileObject = (file: File | null) => {
    globalFileObject = file;
};

export const getFileObject = (): File | null => {
    return globalFileObject;
};


interface LogFileState {
    name: string;
    size: number;
    content: string;
    format: string;
    analyticsSessionId: string;
    loaded: boolean;
    lastModified: number;
    hasFileHandle: boolean; // Flag indicating if we have a File System Access API handle
    isMonitoring: boolean; // Flag for live monitoring state
    isLargeFile: boolean; // Flag for chunked loading mode
    isIndexing: boolean;
    indexingProgress: number;
}

const initialLogFileState: LogFileState = {
    name: '',
    size: 0,
    content: '',
    format: '',
    analyticsSessionId: '',
    loaded: false,
    lastModified: 0,
    hasFileHandle: false,
    isMonitoring: false,
    isLargeFile: false,
    isIndexing: false,
    indexingProgress: 0,
};

const logFileSlice = createSlice({
    name: 'logFile',
    initialState: initialLogFileState,
    reducers: {
        setLogFile: (state, action: PayloadAction<{
            name: string;
            size: number;
            format: string;
            content?: string;
            lastModified?: number;
            hasFileHandle?: boolean;
            isLargeFile?: boolean;
            analyticsSessionId?: string;
        }>) => {
            console.log('setLogFile');
            state.name = action.payload.name;
            state.size = action.payload.size;
            state.content = action.payload.content ?? '';
            state.format = action.payload.format;
            if ('analyticsSessionId' in action.payload) {
                state.analyticsSessionId = action.payload.analyticsSessionId ?? '';
            } else {
                state.analyticsSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            }
            state.lastModified = action.payload.lastModified || Date.now();
            state.hasFileHandle = action.payload.hasFileHandle || false;
            state.isLargeFile = action.payload.isLargeFile || false;
            state.loaded = true;
        },
        updateLogContent: (state, action: PayloadAction<{ content: string; lastModified?: number; size?: number }>) => {
            console.log('updateLogContent');
            
            if (!state.isLargeFile) {
                state.content = action.payload.content;
            }
            if (action.payload.size !== undefined) {
                state.size = action.payload.size;
            }
            state.lastModified = action.payload.lastModified || Date.now();
        },
        appendLogContent: (state, action: PayloadAction<{ newContent: string; newSize: number; lastModified?: number }>) => {
            console.log('appendLogContent');
            if (!state.isLargeFile) {
                state.content = state.content + action.payload.newContent;
            }
            state.size = action.payload.newSize;
            state.lastModified = action.payload.lastModified || Date.now();
        },
        setMonitoringState: (state, action: PayloadAction<boolean>) => {
            state.isMonitoring = action.payload;
        },
        setIndexingState: (state, action: PayloadAction<{ isIndexing: boolean; progress?: number }>) => {
            state.isIndexing = action.payload.isIndexing;
            if (action.payload.progress !== undefined) {
                state.indexingProgress = action.payload.progress;
            } else if (!action.payload.isIndexing) {
                state.indexingProgress = 0;
            }
        },
        clearLogContent: (state) => {
            state.content = '';
        },
        clearLogFile: (state) => {
            state.name = '';
            state.size = 0;
            state.content = '';
            state.format = '';
            state.analyticsSessionId = '';
            state.loaded = false;
            state.lastModified = 0;
            state.hasFileHandle = false;
            state.isMonitoring = false;
            state.isLargeFile = false;
            state.isIndexing = false;
            state.indexingProgress = 0;
        },
    },
});

export const {
    setLogFile,
    updateLogContent,
    appendLogContent,
    setMonitoringState,
    setIndexingState,
    clearLogContent,
    clearLogFile,
} = logFileSlice.actions;

export default logFileSlice.reducer;
