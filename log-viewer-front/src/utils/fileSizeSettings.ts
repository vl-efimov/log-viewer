const STORAGE_KEY = 'logViewer.largeFileThresholdMb.v1';

export const LARGE_FILE_THRESHOLD_DEFAULT_MB = 300;

export const LARGE_FILE_THRESHOLD_RANGE = {
    min: 50,
    max: 1024,
    step: 50,
} as const;

const clampThresholdMb = (value: number): number => {
    const rounded = Math.round(value / LARGE_FILE_THRESHOLD_RANGE.step) * LARGE_FILE_THRESHOLD_RANGE.step;
    return Math.min(
        LARGE_FILE_THRESHOLD_RANGE.max,
        Math.max(LARGE_FILE_THRESHOLD_RANGE.min, rounded)
    );
};

export const sanitizeLargeFileThresholdMb = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return LARGE_FILE_THRESHOLD_DEFAULT_MB;
    }

    return clampThresholdMb(value);
};

export const loadLargeFileThresholdMb = (): number => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return LARGE_FILE_THRESHOLD_DEFAULT_MB;
        }

        return sanitizeLargeFileThresholdMb(Number(raw));
    } catch {
        return LARGE_FILE_THRESHOLD_DEFAULT_MB;
    }
};

export const saveLargeFileThresholdMb = (value: number): number => {
    const safeValue = sanitizeLargeFileThresholdMb(value);

    try {
        window.localStorage.setItem(STORAGE_KEY, String(safeValue));
    } catch {
        return safeValue;
    }

    return safeValue;
};

export const getLargeFileThresholdBytes = (): number => loadLargeFileThresholdMb() * 1024 * 1024;

export const isLargeFileByThreshold = (fileSizeBytes: number): boolean => fileSizeBytes >= getLargeFileThresholdBytes();