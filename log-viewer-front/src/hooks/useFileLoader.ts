import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RouteViewLogs } from '../routes/routePaths';
import { setLogFile, setMonitoringState, setFileHandle } from '../redux/slices/logFileSlice';
import { detectLogFormat } from '../utils/logFormatDetector';

export const useFileLoader = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [indexing, setIndexing] = useState(false);

    const loadFile = async (file: File, handle?: FileSystemFileHandle) => {
        setIndexing(true);
        try {
            const content = await file.text();
            const detectedFormat = detectLogFormat(content);

            if (handle) {
                setFileHandle(handle);
            }

            dispatch(setLogFile({
                name: file.name,
                size: file.size,
                content: content,
                format: detectedFormat || 'Unknown',
                lastModified: file.lastModified,
                hasFileHandle: !!handle,
            }));
        } finally {
            setIndexing(false);
        }
        
        dispatch(setMonitoringState(true));

        setTimeout(() => {
            navigate(RouteViewLogs);
        }, 300);
    };

    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        await loadFile(file);
    };

    const handleFileSystemAccess = async (): Promise<boolean> => {
        if (!('showOpenFilePicker' in window)) {
            return false; // Not supported
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [handle] = await (window as any).showOpenFilePicker({
                types: [
                    {
                        description: 'Log Files',
                        accept: {
                            'text/plain': ['.txt', '.log'],
                            'application/json': ['.json'],
                        },
                    },
                ],
                multiple: false,
            });

            const file = await handle.getFile();
            console.log('File size:', file.size);
            
            await loadFile(file, handle);
            return true;
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                console.error('Error selecting file:', error);
            }
            setIndexing(false);
            return false;
        }
    };

    const stopMonitoring = () => {
        dispatch(setMonitoringState(false));
        setFileHandle(null);
    };

    return {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
        stopMonitoring,
    };
};
