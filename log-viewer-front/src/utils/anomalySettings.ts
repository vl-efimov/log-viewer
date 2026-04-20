export type AnalysisScope = 'all' | 'filtered';
export type TimestampColumnOption = 'auto' | 'timestamp' | 'datetime' | 'time' | 'date' | 'event_time' | 'created_at';
export type AnomalyModelId = 'bgl' | 'hdfs';

export interface AnomalySettings {
    modelId: AnomalyModelId;
    threshold: number;
    stepSize: number;
    minRegionLines: number;
    analysisScope: AnalysisScope;
    timestampColumn: TimestampColumnOption;
}

export const ANOMALY_SETTINGS_DEFAULTS: AnomalySettings = {
    modelId: 'bgl',
    threshold: 0.6,
    stepSize: 20,
    minRegionLines: 1,
    analysisScope: 'all',
    timestampColumn: 'auto',
};

type PersistedAnomalySettingsV2 = {
    selectedModelId?: AnomalyModelId;
    models?: Partial<Record<AnomalyModelId, Partial<AnomalySettings>>>;
};

export const ANOMALY_THRESHOLD_RANGE = {
    min: 0.05,
    max: 0.95,
    step: 0.05,
};

export const ANOMALY_STEP_SIZE_RANGE = {
    min: 1,
    max: 20,
    step: 1,
};

export const ANOMALY_MIN_REGION_LINES_RANGE = {
    min: 1,
    max: 200,
    step: 1,
};

const STORAGE_KEY = 'logViewer.anomalySettings.v1';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return clamp(parsed, min, max);
}

export function sanitizeAnomalySettings(input: Partial<AnomalySettings> | null | undefined): AnomalySettings {
    const settings = input ?? {};
    const safeModelId: AnomalyModelId = settings.modelId === 'hdfs' ? 'hdfs' : 'bgl';
    return {
        modelId: safeModelId,
        threshold: normalizeNumber(
            settings.threshold,
            ANOMALY_SETTINGS_DEFAULTS.threshold,
            ANOMALY_THRESHOLD_RANGE.min,
            ANOMALY_THRESHOLD_RANGE.max,
        ),
        stepSize: Math.round(normalizeNumber(
            settings.stepSize,
            ANOMALY_SETTINGS_DEFAULTS.stepSize,
            ANOMALY_STEP_SIZE_RANGE.min,
            ANOMALY_STEP_SIZE_RANGE.max,
        )),
        minRegionLines: Math.round(normalizeNumber(
            settings.minRegionLines,
            ANOMALY_SETTINGS_DEFAULTS.minRegionLines,
            ANOMALY_MIN_REGION_LINES_RANGE.min,
            ANOMALY_MIN_REGION_LINES_RANGE.max,
        )),
        analysisScope: settings.analysisScope === 'filtered' ? 'filtered' : 'all',
        timestampColumn: (
            settings.timestampColumn === 'timestamp'
            || settings.timestampColumn === 'datetime'
            || settings.timestampColumn === 'time'
            || settings.timestampColumn === 'date'
            || settings.timestampColumn === 'event_time'
            || settings.timestampColumn === 'created_at'
            || settings.timestampColumn === 'auto'
        )
            ? settings.timestampColumn
            : ANOMALY_SETTINGS_DEFAULTS.timestampColumn,
    };
}

function isModelId(value: unknown): value is AnomalyModelId {
    return value === 'bgl' || value === 'hdfs';
}

function sanitizeModelSettings(modelId: AnomalyModelId, input: Partial<AnomalySettings> | null | undefined): AnomalySettings {
    return sanitizeAnomalySettings({ ...(input ?? {}), modelId });
}

function defaultSettingsForModel(modelId: AnomalyModelId): AnomalySettings {
    return {
        ...ANOMALY_SETTINGS_DEFAULTS,
        modelId,
    };
}

function parsePersistedSettings(): PersistedAnomalySettingsV2 {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw) as Partial<PersistedAnomalySettingsV2 & Partial<AnomalySettings>>;

        // Backward compatibility: old format stored a single settings object.
        if ('threshold' in parsed || 'stepSize' in parsed || 'minRegionLines' in parsed || 'timestampColumn' in parsed) {
            const legacy = sanitizeAnomalySettings(parsed);
            const selectedModelId = legacy.modelId;
            return {
                selectedModelId,
                models: {
                    [selectedModelId]: legacy,
                },
            };
        }

        const selectedModelId = isModelId(parsed.selectedModelId) ? parsed.selectedModelId : undefined;
        const models: PersistedAnomalySettingsV2['models'] = {};
        const rawModels = parsed.models;

        if (rawModels && typeof rawModels === 'object') {
            if (rawModels.bgl) {
                models.bgl = sanitizeModelSettings('bgl', rawModels.bgl);
            }
            if (rawModels.hdfs) {
                models.hdfs = sanitizeModelSettings('hdfs', rawModels.hdfs);
            }
        }

        return {
            selectedModelId,
            models,
        };
    } catch {
        return {};
    }
}

function writePersistedSettings(payload: PersistedAnomalySettingsV2): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadSelectedAnomalyModelId(): AnomalyModelId {
    const persisted = parsePersistedSettings();
    return persisted.selectedModelId ?? 'bgl';
}

export function saveSelectedAnomalyModelId(modelId: AnomalyModelId): void {
    const persisted = parsePersistedSettings();
    writePersistedSettings({
        selectedModelId: modelId,
        models: persisted.models ?? {},
    });
}

export function loadAnomalySettings(modelId: AnomalyModelId = loadSelectedAnomalyModelId()): AnomalySettings {
    const persisted = parsePersistedSettings();
    const settings = persisted.models?.[modelId];
    if (!settings) {
        return defaultSettingsForModel(modelId);
    }

    return sanitizeModelSettings(modelId, settings);
}

export function saveAnomalySettings(settings: AnomalySettings): void {
    const safe = sanitizeAnomalySettings(settings);
    const persisted = parsePersistedSettings();
    writePersistedSettings({
        selectedModelId: safe.modelId,
        models: {
            ...(persisted.models ?? {}),
            [safe.modelId]: safe,
        },
    });
}
