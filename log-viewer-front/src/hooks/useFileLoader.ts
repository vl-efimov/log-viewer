import { useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    clearLogFile,
    getFileHandle,
    getFileObject,
    setLogFile,
    setMonitoringState,
    setFileHandle,
    setFileObject,
    setIndexingState,
} from '../redux/slices/logFileSlice';
import { enqueueNotification } from '../redux/slices/notificationsSlice';
import type { RootState } from '../redux/store';
import { detectLogFormat, initializeLogFormats } from '../utils/logFormatDetector';
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

type UnknownFormatResolution = {
    mode: 'continue-unknown' | 'use-format';
    formatId?: string;
};

type UnknownFormatContext = {
    fileName: string;
    fileSize: number;
    previewText: string;
    previewLines: string[];
};

type MonitoringFileReplaceContext = {
    expectedName?: string;
    selectedName: string;
    expectedSize?: number;
    selectedSize: number;
};

type LoadFileOptions = {
    forcedFormatId?: string;
    skipUnknownPrompt?: boolean;
};

type UseFileLoaderOptions = {
    resolveUnknownFormat?: (context: UnknownFormatContext) => Promise<UnknownFormatResolution>;
    confirmMonitoringFileReplace?: (context: MonitoringFileReplaceContext) => Promise<boolean>;
    onFileLoadStart?: () => void;
};

export const useFileLoader = (options: UseFileLoaderOptions = {}) => {
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const [indexing, setIndexing] = useState(false);
    const currentSessionId = useSelector((state: RootState) => state.logFile.analyticsSessionId);
    const activeSessionIdRef = useRef<string | null>(null);
    const loadTokenRef = useRef(0);

    const loadFile = async (file: File, handle?: FileSystemFileHandle, loadOptions: LoadFileOptions = {}) => {
        const loadToken = ++loadTokenRef.current;
        const isLargeFile = file.size >= LARGE_FILE_BYTES;

        options.onFileLoadStart?.();

        setIndexing(true);
        dispatch(setIndexingState({ isIndexing: true, progress: 0 }));
        dispatch(setLogFile({
            name: file.name,
            size: file.size,
            format: '',
            content: '',
            lastModified: file.lastModified,
            hasFileHandle: !!handle,
            isLargeFile,
            analyticsSessionId: '',
        }));
        const sessionIdToCancel = activeSessionIdRef.current || currentSessionId;
        if (sessionIdToCancel) {
            cancelIndexing(sessionIdToCancel);
            await deleteSessionData(sessionIdToCancel);
            if (activeSessionIdRef.current === sessionIdToCancel) {
                activeSessionIdRef.current = null;
            }
        }

        try {
            await initializeLogFormats();

            const previewBlob = file.slice(0, Math.min(file.size, FORMAT_PREVIEW_BYTES));
            const previewText = await previewBlob.text();
            const detectedFormat = detectLogFormat(previewText);
            let formatId = (loadOptions.forcedFormatId || detectedFormat || 'unknown').trim() || 'unknown';

            if (loadToken !== loadTokenRef.current) {
                return;
            }

            if (
                !loadOptions.forcedFormatId
                && !loadOptions.skipUnknownPrompt
                && formatId === 'unknown'
                && options.resolveUnknownFormat
            ) {
                const resolution = await options.resolveUnknownFormat({
                    fileName: file.name,
                    fileSize: file.size,
                    previewText,
                    previewLines: previewText.split(/\r?\n/).slice(0, 5),
                });

                if (loadToken !== loadTokenRef.current) {
                    return;
                }

                if (resolution.mode === 'use-format' && resolution.formatId?.trim()) {
                    formatId = resolution.formatId.trim();
                }
            }

            if (handle) {
                setFileHandle(handle);
            } else {
                setFileHandle(null);
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
                    format: formatId,
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
                    formatId,
                    previewText,
                });
                activeSessionIdRef.current = session.sessionId;

                dispatch(setLogFile({
                    name: file.name,
                    size: file.size,
                    content: content,
                    format: formatId,
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
                        if (loadToken !== loadTokenRef.current) {
                            return;
                        }
                        const percent = progress.totalBytes > 0
                            ? Math.min(99, Math.max(0, Math.round((progress.processedBytes / progress.totalBytes) * 100)))
                            : 0;
                        dispatch(setIndexingState({ isIndexing: true, progress: percent }));
                    },
                }).then(() => {
                    if (loadToken !== loadTokenRef.current) {
                        return;
                    }
                    dispatch(enqueueNotification({
                        message: t('fileSelection.indexingComplete', { fileName: file.name }),
                        severity: 'success',
                    }));
                }).catch((error) => {
                    if ((error as Error).name !== 'AbortError') {
                        console.error('Indexing failed:', error);
                    }
                }).finally(() => {
                    clearIndexingController(session.sessionId);

                    if (loadToken !== loadTokenRef.current) {
                        return;
                    }
                    setIndexing(false);
                    dispatch(setIndexingState({ isIndexing: false, progress: 0 }));
                });
            }
        } catch (error) {
            if (loadToken === loadTokenRef.current) {
                setIndexing(false);
                dispatch(setIndexingState({ isIndexing: false, progress: 0 }));
            }
            throw error;
        }

        if (loadToken === loadTokenRef.current) {
            dispatch(setMonitoringState(true));
        }
    };

    const reloadCurrentFileWithFormat = async (formatId: string): Promise<boolean> => {
        const fileHandle = getFileHandle();
        if (fileHandle) {
            const file = await fileHandle.getFile();
            await loadFile(file, fileHandle, {
                forcedFormatId: formatId,
                skipUnknownPrompt: true,
            });
            return true;
        }

        const file = getFileObject();
        if (!file) {
            return false;
        }

        await loadFile(file, undefined, {
            forcedFormatId: formatId,
            skipUnknownPrompt: true,
        });
        return true;
    };

    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        await loadFile(file);
    };

    const handleFileDrop = async (file: File) => {
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
                        description: t('fileSelection.filePickerDescription'),
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
        attachOptions: AttachOptions = {}
    ): Promise<ReattachResult> => {
        if (!('showOpenFilePicker' in window)) {
            return 'failed'; // Not supported
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [handle] = await (window as any).showOpenFilePicker({
                types: [
                    {
                        description: t('fileSelection.filePickerDescription'),
                        accept: {
                            'text/plain': ['.txt', '.log'],
                            'application/json': ['.json'],
                        },
                    },
                ],
                multiple: false,
            });

            const file = await handle.getFile();
            const isDifferentFile = Boolean(attachOptions.expectedName && attachOptions.expectedName !== file.name);

            if (isDifferentFile) {
                const fallbackConfirmMessage = attachOptions.expectedName
                    ? t('viewLogs.monitoringReplace.withNames', {
                        expectedName: attachOptions.expectedName,
                        selectedName: file.name,
                    })
                    : t('viewLogs.monitoringReplace.withoutNames');
                const shouldReplace = options.confirmMonitoringFileReplace
                    ? await options.confirmMonitoringFileReplace({
                        expectedName: attachOptions.expectedName,
                        selectedName: file.name,
                        expectedSize: attachOptions.expectedSize,
                        selectedSize: file.size,
                    })
                    : window.confirm(fallbackConfirmMessage);
                if (!shouldReplace) {
                    return 'cancelled';
                }

                await loadFile(file, handle);
                return 'switched';
            }

            if (attachOptions.expectedSize && file.size < attachOptions.expectedSize) {
                await loadFile(file, handle);
                return 'switched';
            }

            if (attachOptions.expectedSize && attachOptions.expectedSize !== file.size) {
                console.warn('Selected file size differs from session:', {
                    expected: attachOptions.expectedSize,
                    actual: file.size,
                });
            }
            if (attachOptions.expectedLastModified && attachOptions.expectedLastModified !== file.lastModified) {
                console.warn('Selected file lastModified differs from session:', {
                    expected: attachOptions.expectedLastModified,
                    actual: file.lastModified,
                });
            }

            setFileHandle(handle);
            setFileObject(file);

            await initializeLogFormats();

            const previewBlob = file.slice(0, Math.min(file.size, FORMAT_PREVIEW_BYTES));
            const previewText = await previewBlob.text();
            const detectedFormat = detectLogFormat(previewText);

            dispatch(setLogFile({
                name: file.name,
                size: file.size,
                content: previewText,
                format: attachOptions.formatHint || detectedFormat || 'Unknown',
                lastModified: file.lastModified,
                hasFileHandle: true,
                isLargeFile: attachOptions.isLargeFile ?? file.size >= LARGE_FILE_BYTES,
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
        handleFileDrop,
        handleFileSystemAccess,
        handleFileSystemAccessForMonitoring,
        reloadCurrentFileWithFormat,
        stopMonitoring,
    };
};
