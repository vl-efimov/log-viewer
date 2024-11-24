import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface FileState {
    data: string | null;
}

const initialState: FileState = { data: null };

const fileSlice = createSlice({
    name: 'file',
    initialState,
    reducers: {
        setFileData: (state, action: PayloadAction<string>) => {
            state.data = action.payload;
        },
        clearFileData: (state) => {
            state.data = null;
        },
    },
});

export const { setFileData, clearFileData } = fileSlice.actions;
export default fileSlice.reducer;
