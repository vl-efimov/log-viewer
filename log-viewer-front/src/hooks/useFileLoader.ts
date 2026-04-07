import { useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { clearLogFile, setLogFile, setMonitoringState, setFileHandle, setFileObject, setIndexingState } from '../redux/slices/logFileSlice';
import type { RootState } from '../redux/store';
import { detectLogFormat } from '../utils/logFormatDetector';
import { deleteSessionData } from '../utils/logIndexedDb';
import { cancelIndexing, clearIndexingController, createSessionRecord, indexLogFile, registerIndexingController } from '../utils/logIndexer';

const LARGE_FILE_BYTES = 300 * 1024 * 1024; // 300 MB
const FORMAT_PREVIEW_BYTES = 2 * 1024 * 1024; // 2 MB

type AttachOptions = {
    expectedName?: string;
    expectedSize?: number;
    expectedLastModified?: number;
    formatHint?: string;
    isLargeFile?: boolean;
};

type ReattachResult = 'attached' | 'switched' | 'cancelled' | 'failed';

export const useFileLoader = () => {
    const dispatch = useDispatch();
    const [indexing, setIndexing] = useState(false);
    const currentSessionId = useSelector((state: RootState) => state.logFile.analyticsSessionId);
    const activeSessionIdRef = useRef<string | null>(null);

    const loadFile = async (file: File, handle?: FileSystemFileHandle) => {
        setIndexing(true);
        dispatch(setIndexingState({ isIndexing: true, progress: 0 }));
        if (currentSessionId) {
            cancelIndexing(currentSessionId);
            await deleteSessionData(currentSessionId);
        }

        try {
            const isLargeFile = file.size >= LARGE_FILE_BYTES;
            const previewBlob = file.slice(0, Math.min(file.size, FORMAT_PREVIEW_BYTES));
            const previewText = await previewBlob.text();
            const detectedFormat = detectLogFormat(previewText);

            if (handle) {
                setFileHandle(handle);
            }
            setFileObject(file);

            const content = previewText;

            if (isLargeFile) {
                setIndexing(false);
                dispatch(setIndexingState({ isIndexing: false, progress: 0 }));
                activeSessionIdRef.current = null;
                dispatch(setLogFile({
                    name: file.name,
                    size: file.size,
                    content: content,
                    format: detectedFormat || 'Unknown',
                    lastModified: file.lastModified,
                    hasFileHandle: !!handle,
                    isLargeFile,
                    analyticsSessionId: '',
                }));
            } else {
                const session = createSessionRecord({
                    fileName: file.name,
                    fileSize: file.size,
                    lastModified: file.lastModified,
                    formatId: detectedFormat || 'unknown',
                    previewText,
                });
                activeSessionIdRef.current = session.sessionId;

                dispatch(setLogFile({
                    name: file.name,
                    size: file.size,
                    content: content,
                    format: detectedFormat || 'Unknown',
                    lastModified: file.lastModified,
                    hasFileHandle: !!handle,
                    isLargeFile,
                    analyticsSessionId: session.sessionId,
                }));

                const controller = new AbortController();
                registerIndexingController(session.sessionId, controller);
                void indexLogFile(file, session, {
                    signal: controller.signal,
                    onProgress: (progress) => {
                        const percent = progress.totalBytes > 0
                            ? Math.min(99, Math.max(0, Math.round((progress.processedBytes / progress.totalBytes) * 100)))
                            : 0;
                        dispatch(setIndexingState({ isIndexing: true, progress: percent }));
                    },
                }).catch((error) => {
                    if ((error as Error).name !== 'AbortError') {
                        console.error('Indexing failed:', error);
                    }
                }).finally(() => {
                    clearIndexingController(session.sessionId);
                    setIndexing(false);
                    dispatch(setIndexingState({ isIndexing: false, progress: 0 }));
                });
            }
        } catch (error) {
            setIndexing(false);
            dispatch(setIndexingState({ isIndexing: false, progress: 0 }));
            throw error;
        }
        
        dispatch(setMonitoringState(true));
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
            if ((error as Error).name === 'AbortError') {
                // User cancelled the picker; treat as handled to avoid fallback dialog.
                setIndexing(false);
                return true;
            }

            console.error('Error selecting file:', error);
            setIndexing(false);
            return false;
        }
    };

    const handleFileSystemAccessForMonitoring = async (
        sessionId: string,
        options: AttachOptions = {}
    ): Promise<ReattachResult> => {
        if (!('showOpenFilePicker' in window)) {
            return 'failed'; // Not supported
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
            const isDifferentFile = Boolean(options.expectedName && options.expectedName !== file.name);

            if (isDifferentFile) {
                const shouldReplace = window.confirm(
                    'Вы выбрали другой файл. Данные в IndexedDB будут перезаписаны. Продолжить?'
                );
                if (!shouldReplace) {
                    return 'cancelled';
                }

                await loadFile(file, handle);
                return 'switched';
            }

            if (options.expectedSize && file.size < options.expectedSize) {
                await loadFile(file, handle);
                return 'switched';
            }

            if (options.expectedSize && options.expectedSize !== file.size) {
                console.warn('Selected file size differs from session:', {
                    expected: options.expectedSize,
                    actual: file.size,
                });
            }
            if (options.expectedLastModified && options.expectedLastModified !== file.lastModified) {
                console.warn('Selected file lastModified differs from session:', {
                    expected: options.expectedLastModified,
                    actual: file.lastModified,
                });
            }

            setFileHandle(handle);
            setFileObject(file);

            const previewBlob = file.slice(0, Math.min(file.size, FORMAT_PREVIEW_BYTES));
            const previewText = await previewBlob.text();
            const detectedFormat = detectLogFormat(previewText);

            dispatch(setLogFile({
                name: file.name,
                size: file.size,
                content: previewText,
                format: options.formatHint || detectedFormat || 'Unknown',
                lastModified: file.lastModified,
                hasFileHandle: true,
                isLargeFile: options.isLargeFile ?? file.size >= LARGE_FILE_BYTES,
                analyticsSessionId: sessionId,
            }));

            dispatch(setMonitoringState(true));
            return 'attached';
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return 'cancelled';
            }

            console.error('Error selecting file for monitoring:', error);
            return 'failed';
        }
    };

    const stopMonitoring = async () => {
        dispatch(setMonitoringState(false));
        dispatch(clearLogFile());
        setFileHandle(null);
        setFileObject(null);
        dispatch(setIndexingState({ isIndexing: false, progress: 0 }));

        const sessionId = activeSessionIdRef.current || currentSessionId;
        if (sessionId) {
            cancelIndexing(sessionId);
            await deleteSessionData(sessionId);
        }

        setIndexing(false);
    };

    return {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
        handleFileSystemAccessForMonitoring,
        stopMonitoring,
    };
};
