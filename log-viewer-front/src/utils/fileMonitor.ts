/**
 * Utility for monitoring file changes using File System Access API
 * Falls back to manual reload if API is not available
 */

export interface FileMonitor {
    startMonitoring: () => Promise<void>;
    stopMonitoring: () => void;
    isSupported: () => boolean;
}

/**
 * Check if File System Access API is available
 */
export function isFileSystemAccessSupported(): boolean {
    return 'showOpenFilePicker' in window;
}

/**
 * Create a file monitor that polls for changes
 * @param onFileChange Callback when file content changes
 * @param intervalMs Polling interval in milliseconds
 */
export function createFileMonitor(
    onFileChange: (content: string) => void,
    intervalMs: number = 1000
): FileMonitor {
    let fileHandle: FileSystemFileHandle | null = null;
    let intervalId: number | null = null;
    let lastModified: number = 0;

    const startMonitoring = async () => {
        if (!isFileSystemAccessSupported()) {
            console.warn('File System Access API not supported');
            return;
        }

        try {
            // Request file access
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

            fileHandle = handle;
            
            // Read initial content
            const file = await handle.getFile();
            lastModified = file.lastModified;
            const content = await file.text();
            onFileChange(content);

            // Start polling for changes
            intervalId = window.setInterval(async () => {
                if (!fileHandle) return;

                try {
                    const currentFile = await fileHandle.getFile();
                    
                    // Check if file was modified
                    if (currentFile.lastModified > lastModified) {
                        lastModified = currentFile.lastModified;
                        const content = await currentFile.text();
                        onFileChange(content);
                    }
                } catch (error) {
                    console.error('Error reading file:', error);
                }
            }, intervalMs);

        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                console.log('User cancelled file selection');
            } else {
                console.error('Error accessing file:', error);
            }
        }
    };

    const stopMonitoring = () => {
        if (intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
        }
        fileHandle = null;
        lastModified = 0;
    };

    const isSupported = () => isFileSystemAccessSupported();

    return {
        startMonitoring,
        stopMonitoring,
        isSupported,
    };
}
