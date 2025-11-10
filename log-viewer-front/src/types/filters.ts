export interface DateRangeFilter {
    start?: Date | null;
    end?: Date | null;
}

export interface TextFilter {
    value: string;
}

export interface LogFilters {
    // Time/Date fields
    timestamp?: DateRangeFilter;
    date?: DateRangeFilter;
    time?: DateRangeFilter;
    datetime?: DateRangeFilter;
    
    // Common fields
    level?: string[];
    message?: TextFilter;
    
    // Source/Class/Logger fields
    source?: TextFilter;
    logger?: TextFilter;
    class?: TextFilter;
    
    // Thread/Process fields
    thread?: TextFilter;
    process?: TextFilter;
    pid?: TextFilter;
    
    // Network fields
    ip?: TextFilter;
    client?: TextFilter;
    hostname?: TextFilter;
    
    // User/Auth fields
    user?: TextFilter;
    ident?: TextFilter;
    
    // HTTP fields
    method?: TextFilter;
    path?: TextFilter;
    protocol?: TextFilter;
    status?: TextFilter;
    bytes?: TextFilter;
    referer?: TextFilter;
    userAgent?: TextFilter;
    
    // BGL/HPC fields
    jobId?: TextFilter;
    nodes?: TextFilter;
    runtime?: TextFilter;
    
    // Other fields
    component?: TextFilter;
    module?: TextFilter;
    location?: TextFilter;
    content?: TextFilter;
    
    // Generic catch-all
    [key: string]: DateRangeFilter | TextFilter | string[] | undefined;
}

export const LOG_LEVELS = [
    'TRACE',
    'DEBUG',
    'INFO',
    'WARN',
    'WARNING',
    'ERROR',
    'FATAL',
    'CRITICAL',
] as const;

export type LogLevel = typeof LOG_LEVELS[number];
