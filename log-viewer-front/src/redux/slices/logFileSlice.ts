import { createSlice, PayloadAction } from '@reduxjs/toolkit';

// Global storage for FileSystemFileHandle (can't be serialized in Redux)
let globalFileHandle: FileSystemFileHandle | null = null;

export const setFileHandle = (handle: FileSystemFileHandle | null) => {
    globalFileHandle = handle;
};

export const getFileHandle = (): FileSystemFileHandle | null => {
    return globalFileHandle;
};

interface LogFileState {
    name: string;
    size: number;
    content: string;
    format: string;
    loaded: boolean;
    lastModified: number;
    hasFileHandle: boolean; // Flag indicating if we have a File System Access API handle
    isMonitoring: boolean; // Flag for live monitoring state
}

const initialState: LogFileState = {
    name: '',
    size: 0,
    content: '',
    format: '',
    loaded: false,
    lastModified: 0,
    hasFileHandle: false,
    isMonitoring: false,
};

const logFileSlice = createSlice({
    name: 'logFile',
    initialState,
    reducers: {
        setLogFile: (state, action: PayloadAction<{
            name: string;
            size: number;
            content: string;
            format: string;
            lastModified?: number;
            hasFileHandle?: boolean;
        }>) => {
            state.name = action.payload.name;
            state.size = action.payload.size;
            state.content = action.payload.content;
            state.format = action.payload.format;
            state.lastModified = action.payload.lastModified || Date.now();
            state.hasFileHandle = action.payload.hasFileHandle || false;
            state.loaded = true;
        },
        updateLogContent: (state, action: PayloadAction<{ content: string; lastModified?: number }>) => {
            state.content = action.payload.content;
            state.lastModified = action.payload.lastModified || Date.now();
        },
        appendLogContent: (state, action: PayloadAction<{ newContent: string; newSize: number; lastModified?: number }>) => {
            state.content = state.content + action.payload.newContent;
            state.size = action.payload.newSize;
            state.lastModified = action.payload.lastModified || Date.now();
        },
        setMonitoringState: (state, action: PayloadAction<boolean>) => {
            state.isMonitoring = action.payload;
        },
        clearLogFile: (state) => {
            state.name = '';
            state.size = 0;
            state.content = '';
            state.format = '';
            state.loaded = false;
            state.lastModified = 0;
            state.hasFileHandle = false;
            state.isMonitoring = false;
        },
    },
});

export const { setLogFile, updateLogContent, appendLogContent, setMonitoringState, clearLogFile } = logFileSlice.actions;
export default logFileSlice.reducer;
