import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RouteViewLogs } from '../routes/routePaths';
import { setLogFile, setMonitoringState, setFileHandle, setLazyReader } from '../redux/slices/logFileSlice';
import { detectLogFormat } from '../utils/logFormatDetector';
import { LazyFileReader } from '../utils/lazyFileReader';

const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB

export const useFileLoader = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [indexing, setIndexing] = useState(false);

    const loadFile = async (file: File, handle?: FileSystemFileHandle) => {
        const useLazy = file.size > LARGE_FILE_THRESHOLD;
        
        if (useLazy) {
            console.log('Large file detected, using lazy loading');
            setIndexing(true);
            
            try {
                // Create lazy reader and build index
                const lazyReader = new LazyFileReader(file);
                await lazyReader.buildIndex();
                
                const totalLines = lazyReader.getTotalLines();
                console.log('Indexed lines:', totalLines);
                
                // Read first 1000 lines to detect format
                const firstLines = await lazyReader.readLines(1, Math.min(1000, totalLines));
                const sampleContent = firstLines.map(l => l.content).join('\n');
                const detectedFormat = detectLogFormat(sampleContent);
                
                // Store the handle and lazy reader globally
                if (handle) {
                    setFileHandle(handle);
                }
                setLazyReader(lazyReader);
                
                // Store file info in Redux (no full content)
                dispatch(setLogFile({
                    name: file.name,
                    size: file.size,
                    content: '', // Empty for lazy loading
                    format: detectedFormat || 'Unknown',
                    lastModified: file.lastModified,
                    hasFileHandle: !!handle,
                    totalLines: totalLines,
                    useLazyLoading: true,
                }));
            } finally {
                setIndexing(false);
            }
        } else {
            console.log('Small file, loading fully');
            const content = await file.text();

            // Detect log format
            const detectedFormat = detectLogFormat(content);

            // Store the handle globally
            if (handle) {
                setFileHandle(handle);
            }
            setLazyReader(null);

            // Store file info in Redux
            dispatch(setLogFile({
                name: file.name,
                size: file.size,
                content: content,
                format: detectedFormat || 'Unknown',
                lastModified: file.lastModified,
                hasFileHandle: !!handle,
                totalLines: content.split(/\r?\n/).length,
                useLazyLoading: false,
            }));
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
