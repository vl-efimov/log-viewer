export interface BglPredictRow {
    message: string;
    timestamp?: string | null;
    datetime?: string | null;
    time?: string | null;
    date?: string | null;
    event_time?: string | null;
    created_at?: string | null;
}

export interface BglPredictRequest {
    model_id?: string;
    rows: BglPredictRow[];
    text_column?: string;
    timestamp_column?: string;
    threshold?: number;
    step_size?: number;
    min_region_lines?: number;
    include_rows?: boolean;
    include_windows?: boolean;
}

export interface BglAnomalyRegion {
    start_index: number;
    end_index: number;
    start_line: number;
    end_line: number;
    count: number;
    start_timestamp: string | null;
    end_timestamp: string | null;
}

export interface BglPredictResponse {
    meta: {
        total_rows: number;
        anomaly_rows: number;
        anomaly_ratio: number;
        threshold: number;
        window_size: number;
        step_size: number;
        min_region_lines: number;
        model_id?: string;
    };
    rows?: Array<{
        index: number;
        line: number;
        is_anomaly: boolean;
        score: number;
    }> | null;
    windows?: Array<unknown> | null;
    anomaly_lines?: number[];
    anomaly_regions: BglAnomalyRegion[];
}

export interface PretrainedModelInfo {
    id: string;
    modelId: string;
    name: string;
    dataset: string;
    architecture: string;
    localPath: string;
    status: 'ready' | 'installing' | 'unavailable';
    backendUrl: string;
    prepared: boolean;
    prepareProgress: number;
    prepareStage: string;
    prepareMessage: string;
    prepareError?: string;
}

interface ModelStatus {
    model_id: string;
    name: string;
    dataset: string;
    model_path: string;
    model_exists: boolean;
    model_loaded: boolean;
    model_ready: boolean;
    prepare?: {
        preparing?: boolean;
        stage?: string;
        progress?: number;
        message?: string;
        loaded?: boolean;
        error?: string | null;
    };
}

interface BglHealthResponse {
    ok: boolean;
    model_id?: string;
    selected_model_id?: string;
    model_exists?: boolean;
    model_loaded?: boolean;
    model_ready?: boolean;
    prepare?: {
        preparing?: boolean;
        stage?: string;
        progress?: number;
        message?: string;
        loaded?: boolean;
        error?: string | null;
    };
}

interface ModelsStatusResponse {
    ok: boolean;
    models: ModelStatus[];
}

const backendBaseUrl = (import.meta.env.VITE_BGL_API_URL as string | undefined)?.replace(/\/$/, '')
    || 'http://127.0.0.1:8001';

function statusFromModel(model: ModelStatus): PretrainedModelInfo['status'] {
    if (model.model_ready) {
        return 'ready';
    }
    if (model.prepare?.preparing) {
        return 'installing';
    }
    return 'unavailable';
}

function toModelInfo(model: ModelStatus): PretrainedModelInfo {
    const prepared = Boolean(model.model_ready);
    return {
        id: `neurallog-${model.model_id}-transformer`,
        modelId: model.model_id,
        name: model.name,
        dataset: model.dataset,
        architecture: 'Transformer + BERT embeddings',
        localPath: model.model_path.replace(/\\/g, '/').replace(/^.*?backend\//, 'backend/'),
        status: statusFromModel(model),
        backendUrl: backendBaseUrl,
        prepared,
        prepareProgress: Number(model.prepare?.progress ?? 0),
        prepareStage: String(model.prepare?.stage ?? 'idle'),
        prepareMessage: String(model.prepare?.message ?? (prepared ? 'Model is ready' : 'Not prepared')),
        prepareError: model.prepare?.error ?? undefined,
    };
}

export async function predictBglAnomalies(payload: BglPredictRequest): Promise<BglPredictResponse> {
    const response = await fetch(`${backendBaseUrl}/bgl/predict-json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        try {
            const parsed = JSON.parse(errorText) as { detail?: string };
            throw new Error(parsed.detail || `BGL predict request failed (${response.status})`);
        } catch {
            throw new Error(errorText || `BGL predict request failed (${response.status})`);
        }
    }

    return (await response.json()) as BglPredictResponse;
}

export async function predictBglAnomaliesFromFile(
    file: File,
    payload: Omit<BglPredictRequest, 'rows'>,
    options?: { signal?: AbortSignal },
): Promise<BglPredictResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model_id', payload.model_id ?? 'bgl');

    if (payload.text_column) {
        formData.append('text_column', payload.text_column);
    }
    if (payload.timestamp_column) {
        formData.append('timestamp_column', payload.timestamp_column);
    }
    if (typeof payload.threshold === 'number') {
        formData.append('threshold', String(payload.threshold));
    }
    if (typeof payload.step_size === 'number') {
        formData.append('step_size', String(payload.step_size));
    }
    if (typeof payload.min_region_lines === 'number') {
        formData.append('min_region_lines', String(payload.min_region_lines));
    }
    if (typeof payload.include_rows === 'boolean') {
        formData.append('include_rows', String(payload.include_rows));
    }
    if (typeof payload.include_windows === 'boolean') {
        formData.append('include_windows', String(payload.include_windows));
    }

    const response = await fetch(`${backendBaseUrl}/bgl/predict-file`, {
        method: 'POST',
        body: formData,
        signal: options?.signal,
    });

    if (!response.ok) {
        const errorText = await response.text();
        try {
            const parsed = JSON.parse(errorText) as { detail?: string };
            throw new Error(parsed.detail || `BGL predict request failed (${response.status})`);
        } catch {
            throw new Error(errorText || `BGL predict request failed (${response.status})`);
        }
    }

    return (await response.json()) as BglPredictResponse;
}

export async function getPretrainedModels(): Promise<PretrainedModelInfo[]> {
    try {
        const response = await fetch(`${backendBaseUrl}/models/status`);
        if (response.ok) {
            const payload = await response.json() as ModelsStatusResponse;
            return payload.models.map(toModelInfo);
        }
        // Fall through to old endpoint compatibility.
    } catch {
        // fallback below
    }

    try {
        const [bglStatusResponse, hdfsStatusResponse] = await Promise.all([
            fetch(`${backendBaseUrl}/prepare/status?model_id=bgl`),
            fetch(`${backendBaseUrl}/prepare/status?model_id=hdfs`),
        ]);

        if (bglStatusResponse.ok || hdfsStatusResponse.ok) {
            const bglStatus = bglStatusResponse.ok ? await bglStatusResponse.json() as BglHealthResponse : null;
            const hdfsStatus = hdfsStatusResponse.ok ? await hdfsStatusResponse.json() as BglHealthResponse : null;
            const supportsPerModel = Boolean(
                bglStatus?.model_id || bglStatus?.selected_model_id || hdfsStatus?.model_id || hdfsStatus?.selected_model_id
            );

            return [
                {
                    id: 'neurallog-bgl-transformer',
                    modelId: 'bgl',
                    name: 'NeuralLog Transformer (BGL)',
                    dataset: 'BGL',
                    architecture: 'Transformer + BERT embeddings',
                    localPath: 'backend/NeuralLog/saved_models/bgl_transformer.hdf5',
                    status: (bglStatus?.model_ready || bglStatus?.prepare?.loaded) ? 'ready' : (bglStatus?.prepare?.preparing ? 'installing' : 'unavailable'),
                    backendUrl: backendBaseUrl,
                    prepared: Boolean(bglStatus?.model_ready || bglStatus?.prepare?.loaded),
                    prepareProgress: Number(bglStatus?.prepare?.progress ?? 0),
                    prepareStage: String(bglStatus?.prepare?.stage ?? 'idle'),
                    prepareMessage: String(bglStatus?.prepare?.message ?? 'Not prepared'),
                    prepareError: bglStatus?.prepare?.error ?? undefined,
                },
                {
                    id: 'neurallog-hdfs-transformer',
                    modelId: 'hdfs',
                    name: 'NeuralLog Transformer (HDFS)',
                    dataset: 'HDFS',
                    architecture: 'Transformer + BERT embeddings',
                    localPath: 'backend/NeuralLog/saved_models/hdfs_transformer.hdf5',
                    status: supportsPerModel
                        ? ((hdfsStatus?.model_ready || hdfsStatus?.prepare?.loaded) ? 'ready' : (hdfsStatus?.prepare?.preparing ? 'installing' : 'unavailable'))
                        : 'unavailable',
                    backendUrl: backendBaseUrl,
                    prepared: supportsPerModel ? Boolean(hdfsStatus?.model_ready || hdfsStatus?.prepare?.loaded) : false,
                    prepareProgress: supportsPerModel ? Number(hdfsStatus?.prepare?.progress ?? 0) : 0,
                    prepareStage: supportsPerModel ? String(hdfsStatus?.prepare?.stage ?? 'idle') : 'unsupported',
                    prepareMessage: supportsPerModel ? String(hdfsStatus?.prepare?.message ?? 'Not prepared') : 'Restart backend to enable HDFS model support',
                    prepareError: supportsPerModel ? (hdfsStatus?.prepare?.error ?? undefined) : undefined,
                },
            ];
        }
    } catch {
        // fallback below
    }

    return [
        {
            id: 'neurallog-bgl-transformer',
            modelId: 'bgl',
            name: 'NeuralLog Transformer (BGL)',
            dataset: 'BGL',
            architecture: 'Transformer + BERT embeddings',
            localPath: 'backend/NeuralLog/saved_models/bgl_transformer.hdf5',
            status: 'unavailable',
            backendUrl: backendBaseUrl,
            prepared: false,
            prepareProgress: 0,
            prepareStage: 'offline',
            prepareMessage: 'Backend unavailable',
            prepareError: undefined,
        },
        {
            id: 'neurallog-hdfs-transformer',
            modelId: 'hdfs',
            name: 'NeuralLog Transformer (HDFS)',
            dataset: 'HDFS',
            architecture: 'Transformer + BERT embeddings',
            localPath: 'backend/NeuralLog/saved_models/hdfs_transformer.hdf5',
            status: 'unavailable',
            backendUrl: backendBaseUrl,
            prepared: false,
            prepareProgress: 0,
            prepareStage: 'offline',
            prepareMessage: 'Backend unavailable',
            prepareError: undefined,
        },
    ];
}

export async function warmupBglModel(modelId: string = 'bgl'): Promise<PretrainedModelInfo['status']> {
    const response = await fetch(`${backendBaseUrl}/prepare/start?model_id=${encodeURIComponent(modelId)}`, {
        method: 'POST',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Warmup failed (${response.status})`);
    }

    const payload = await response.json() as BglHealthResponse;
    if (payload.model_ready || payload.prepare?.loaded) {
        return 'ready';
    }
    if (payload.prepare?.preparing) {
        return 'installing';
    }
    return payload.model_exists ? 'installing' : 'unavailable';
}

export async function isBglModelReady(modelId: string = 'bgl'): Promise<boolean> {
    const response = await fetch(`${backendBaseUrl}/health?model_id=${encodeURIComponent(modelId)}`);
    if (!response.ok) {
        return false;
    }
    const payload = await response.json() as BglHealthResponse;
    return Boolean(payload.model_ready);
}

export async function cancelBglAnomalyPrediction(modelId: string = 'bgl'): Promise<void> {
    const response = await fetch(`${backendBaseUrl}/bgl/cancel?model_id=${encodeURIComponent(modelId)}`, {
        method: 'POST',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Cancel request failed (${response.status})`);
    }
}
