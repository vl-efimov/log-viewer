import { createSlice, PayloadAction } from '@reduxjs/toolkit';


interface LogFileState {
    name: string;
    size: number;
    content: string;
    format: string;
    loaded: boolean;
}

const initialState: LogFileState = {
    name: '',
    size: 0,
    content: '',
    format: '',
    loaded: false,
};

const logFileSlice = createSlice({
    name: 'logFile',
    initialState,
    reducers: {
        setLogFile: (state, action: PayloadAction<Omit<LogFileState, 'loaded'>>) => {
            state.name = action.payload.name;
            state.size = action.payload.size;
            state.content = action.payload.content;
            state.format = action.payload.format;
            state.loaded = true;
        },
        clearLogFile: (state) => {
            state.name = '';
            state.size = 0;
            state.content = '';
            state.format = '';
            state.loaded = false;
        },
    },
});

export const { setLogFile, clearLogFile } = logFileSlice.actions;
export default logFileSlice.reducer;
