/**
 * Log format detection configuration
 * Each format has a name, description, patterns for detection, and priority
 */

import { baseUrl } from "../constants/BaseUrl";
import { getCustomLogFormats, type CustomLogFormatRecord } from './logIndexedDb';

export const USER_FORMATS_STORAGE_KEY = 'userLogFormats';

interface StoredUserLogFormat {
    id: string;
    name: string;
    description: string;
    regex: string;
}

export interface LogFormatField {
    /** Field name (matches named capture group in regex) */
    name: string;
    /** Human-readable description of the field */
    description: string;
    /** Data type of the field */
    type: 'string' | 'number' | 'datetime' | 'date' | 'time' | 'duration';
    /** Whether this field is optional */
    optional?: boolean;
    /** Possible values for the field (for enums like log levels) */
    enum?: string[];
}

export interface LogFormatPattern {
    /** Unique identifier for the log format */
    id: string;
    /** Display name of the log format */
    name: string;
    /** Description of the log format */
    description: string;
    /** Array of regex patterns to test against log content (with named capture groups) */
    patterns: RegExp[];
    /** 
     * Priority for detection (higher = checked first)
     * Use this to ensure more specific patterns are checked before generic ones
     */
    priority: number;
    /** 
     * Optional: Additional validation function for complex detection logic
     * Returns true if the format matches
     */
    validate?: (content: string) => boolean;
    /** 
     * Field definitions describing what each named capture group represents
     */
    fields?: LogFormatField[];
    /** Runtime source of this format. */
    source?: 'system' | 'custom';
}

/**
 * Result of parsing a log line with a specific format
 */
export interface ParsedLogLine {
    /** The format that was used to parse this line */
    formatId: string;
    /** The extracted fields as key-value pairs */
    fields: Record<string, string>;
    /** The original log line */
    raw: string;
}

const CANONICAL_FIELD_ALIASES: Record<string, string> = {
    hostname: 'host',
    node: 'host',
    node2: 'host',
    logger: 'class',
    source: 'class',
    client: 'ip',
};

function applyCanonicalFieldAliases(fields: Record<string, string>): Record<string, string> {
    const next = { ...fields };
    const keysByLower = new Map<string, string>();

    Object.keys(next).forEach((key) => {
        keysByLower.set(key.toLowerCase(), key);
    });

    Object.entries(CANONICAL_FIELD_ALIASES).forEach(([alias, canonical]) => {
        const canonicalExistingKey = keysByLower.get(canonical);
        if (canonicalExistingKey) {
            const existingValue = next[canonicalExistingKey];
            if (typeof existingValue === 'string' && existingValue.trim()) {
                return;
            }
        }

        const aliasKey = keysByLower.get(alias);
        if (!aliasKey) {
            return;
        }

        const aliasValue = next[aliasKey];
        if (typeof aliasValue !== 'string' || !aliasValue.trim()) {
            return;
        }

        next[canonical] = aliasValue.trim();
    });

    return next;
}

const MONTH_TO_NUMBER: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
};

function normalizeDateToken(value: string): string | null {
    const date = value.trim();
    if (!date) {
        return null;
    }

    const normalizedSeparators = date.replace(/[./]/g, '-');
    const ymdMatch = normalizedSeparators.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
        const [, year, month, day] = ymdMatch;
        return `${year}-${month}-${day}`;
    }

    const compactYmdMatch = date.match(/^(\d{8})$/);
    if (compactYmdMatch) {
        const digits = compactYmdMatch[1];
        return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    }

    const compactYyMmDd = date.match(/^(\d{6})$/);
    if (compactYyMmDd) {
        const digits = compactYyMmDd[1];
        const yy = parseInt(digits.slice(0, 2), 10);
        const year = yy < 50 ? `20${digits.slice(0, 2)}` : `19${digits.slice(0, 2)}`;
        return `${year}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
    }

    return null;
}

function normalizeTimeToken(value: string): string | null {
    const time = value.trim();
    if (!time) {
        return null;
    }

    const hhmmss = time.match(/^(\d{2}):(\d{2}):(\d{2})([.,]\d{1,6})?$/);
    if (hhmmss) {
        const [, hh, mm, ss, fraction] = hhmmss;
        if (!fraction) {
            return `${hh}:${mm}:${ss}`;
        }

        const digits = fraction.slice(1);
        const millis = digits.padEnd(3, '0').slice(0, 3);
        return `${hh}:${mm}:${ss}.${millis}`;
    }

    const compact = time.match(/^(\d{6})$/);
    if (compact) {
        const digits = compact[1];
        return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
    }

    return null;
}

function buildSyntheticTimestamp(fields: Record<string, string>): string | null {
    const existing = fields.timestamp?.trim() || fields.datetime?.trim();
    if (existing) {
        return null;
    }

    const monthRaw = fields.month?.trim();
    const dayRaw = fields.day?.trim();
    const timeRaw = fields.time?.trim();
    if (monthRaw && dayRaw && timeRaw) {
        const month = MONTH_TO_NUMBER[monthRaw.slice(0, 3).toLowerCase()];
        const dayNumber = Number(dayRaw);
        const normalizedTime = normalizeTimeToken(timeRaw);

        if (month && Number.isFinite(dayNumber) && dayNumber >= 1 && dayNumber <= 31 && normalizedTime) {
            const currentYear = String(new Date().getFullYear());
            return `${currentYear}-${month}-${String(dayNumber).padStart(2, '0')} ${normalizedTime}`;
        }
    }

    const dateRaw = fields.date?.trim();
    if (!dateRaw || !timeRaw) {
        return null;
    }

    const normalizedDate = normalizeDateToken(dateRaw);
    const normalizedTime = normalizeTimeToken(timeRaw);
    if (!normalizedDate || !normalizedTime) {
        return null;
    }

    const alreadyHasFraction = normalizedTime.includes('.');
    const msToken = (fields.milliseconds || fields.millisecond || fields.msec || fields.ms || '').trim();

    if (!alreadyHasFraction && msToken && /^\d{1,6}$/.test(msToken)) {
        const millis = msToken.padEnd(3, '0').slice(0, 3);
        return `${normalizedDate} ${normalizedTime}.${millis}`;
    }

    return `${normalizedDate} ${normalizedTime}`;
}

function normalizeParsedFields(formatId: string, rawFields: Record<string, string>): Record<string, string> {
    void formatId;
    const fields = { ...rawFields };

    const syntheticTimestamp = buildSyntheticTimestamp(fields);
    if (syntheticTimestamp) {
        fields.timestamp = syntheticTimestamp;
    }

    return applyCanonicalFieldAliases(fields);
}

/**
 * Predefined log format patterns
 * Ordered by priority (higher priority formats are checked first)
 */
export let LOG_FORMAT_PATTERNS: LogFormatPattern[] = [];
const CUSTOM_FORMAT_PRIORITY = 10000;

export function extractNamedGroups(regexSource: string): string[] {
    const groups = new Set<string>();
    const namedGroupRegex = /\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g;
    let match: RegExpExecArray | null = namedGroupRegex.exec(regexSource);

    while (match) {
        groups.add(match[1]);
        match = namedGroupRegex.exec(regexSource);
    }

    return Array.from(groups);
}

function getFieldType(name: string): LogFormatField['type'] {
    const normalized = name.toLowerCase();

    if (normalized.includes('timestamp') || normalized.includes('datetime')) {
        return 'datetime';
    }

    if (normalized === 'date') {
        return 'date';
    }

    if (normalized === 'time') {
        return 'time';
    }

    if (
        normalized.includes('count')
        || normalized.includes('size')
        || normalized.includes('bytes')
        || normalized.includes('ms')
        || normalized.includes('code')
        || normalized.includes('status')
    ) {
        return 'number';
    }

    return 'string';
}

function toCustomFormatPattern(format: StoredUserLogFormat): LogFormatPattern | null {
    try {
        const groups = extractNamedGroups(format.regex);
        const normalizedGroupNames = new Set(groups.map((group) => group.toLowerCase()));
        const hasExplicitTimestamp = normalizedGroupNames.has('timestamp') || normalizedGroupNames.has('datetime');
        const canBuildTimestamp = (normalizedGroupNames.has('date') && normalizedGroupNames.has('time'))
            || (normalizedGroupNames.has('month') && normalizedGroupNames.has('day') && normalizedGroupNames.has('time'));

        const fields: LogFormatField[] = groups.map((group) => ({
            name: group,
            description: `Custom field: ${group}`,
            type: getFieldType(group),
        }));

        if (!hasExplicitTimestamp && canBuildTimestamp) {
            fields.unshift({
                name: 'timestamp',
                description: 'Combined date and time',
                type: 'datetime',
            });
        }

        return {
            id: format.id,
            name: format.name,
            description: format.description,
            priority: CUSTOM_FORMAT_PRIORITY,
            patterns: [new RegExp(format.regex, 'm')],
            source: 'custom',
            fields,
        };
    } catch {
        return null;
    }
}

/**
 * Loads log formats from JSON file
 */
export async function loadLogFormatsFromJSON(): Promise<void> {
    try {
        const response = await fetch(`${baseUrl}log-formats.json`);
        const data = await response.json();
        
        // Convert JSON patterns (strings) to RegExp objects
        LOG_FORMAT_PATTERNS = data.formats.map((format: {
            id: string;
            name: string;
            description: string;
            priority: number;
            patterns: string[];
            fields?: LogFormatField[];
        }) => ({
            ...format,
            source: 'system',
            patterns: format.patterns.map((pattern: string) => new RegExp(pattern, 'm'))
        }));
        
        console.log('Loaded log formats:', LOG_FORMAT_PATTERNS.length);
    } catch (error) {
        console.error('Failed to load log formats from JSON:', error);
        // Fallback to empty array
        LOG_FORMAT_PATTERNS = [];
    }
}

/**
 * Initialize log formats (call this at app startup)
 */
let formatsInitialized = false;
export async function initializeLogFormats(): Promise<void> {
    if (!formatsInitialized) {
        await loadLogFormatsFromJSON();
        const userFormats = await getCustomLogFormats();
        userFormats.forEach((format) => {
            const mapped = toCustomFormatPattern(format);
            if (mapped) {
                registerCustomLogFormat(mapped);
            }
        });
        formatsInitialized = true;
    }
}

/**
 * Detects the log format based on content analysis
 * @param content The log file content as string
 * @param previewLines Number of lines to analyze (default: 50)
 * @returns The detected format ID or 'unknown'
 */
export function detectLogFormat(content: string, previewLines: number = 50): string {
    const preview = content.split(/\r?\n/).slice(0, previewLines).join('\n');

    const customPatterns = LOG_FORMAT_PATTERNS
        .filter((format) => format.source === 'custom')
        .sort((a, b) => b.priority - a.priority);

    const systemPatterns = LOG_FORMAT_PATTERNS
        .filter((format) => format.source !== 'custom')
        .sort((a, b) => b.priority - a.priority);

    for (const format of [...customPatterns, ...systemPatterns]) {
        // Check all patterns for this format
        const matchesPattern = format.patterns.some(pattern => pattern.test(preview));
        
        if (matchesPattern) {
            // If there's additional validation, run it
            if (format.validate) {
                if (format.validate(content)) {
                    return format.id;
                }
                // If validation fails, continue to next format
                continue;
            }
            
            // Pattern matched and no additional validation needed
            return format.id;
        }
    }

    return 'unknown';
}

/**
 * Gets all available log formats
 * @returns Array of all configured log formats
 */
export function getAvailableLogFormats(): LogFormatPattern[] {
    return LOG_FORMAT_PATTERNS;
}

/**
 * Gets a specific log format by ID
 * @param id The format ID to look up
 * @returns The log format or undefined if not found
 */
export function getLogFormatById(id: string): LogFormatPattern | undefined {
    return LOG_FORMAT_PATTERNS.find(format => format.id === id);

}

/**
 * Adds a custom log format pattern
 * Useful for plugins or dynamic format registration
 * @param format The custom format to add
 */
export function registerCustomLogFormat(format: LogFormatPattern): void {
    const customFormat: LogFormatPattern = {
        ...format,
        source: 'custom',
        priority: Math.max(format.priority, CUSTOM_FORMAT_PRIORITY),
    };

    // Check if format with this ID already exists
    const existingIndex = LOG_FORMAT_PATTERNS.findIndex(f => f.id === customFormat.id);
    
    if (existingIndex >= 0) {
        // Replace existing format
        LOG_FORMAT_PATTERNS[existingIndex] = customFormat;
    } else {
        // Add new format
        LOG_FORMAT_PATTERNS.push(customFormat);
    }
}

/**
 * Removes a log format by ID.
 */
export function unregisterLogFormat(id: string): void {
    LOG_FORMAT_PATTERNS = LOG_FORMAT_PATTERNS.filter(format => format.id !== id);
}

/**
 * Maps user-defined format data to runtime pattern structure.
 */
export function buildCustomFormatPattern(format: {
    id: string;
    name: string;
    description: string;
    regex: string;
}): LogFormatPattern | null {
    return toCustomFormatPattern(format as CustomLogFormatRecord);
}

/**
 * Parses a log line using a specific format and extracts named fields
 * @param line The log line to parse
 * @param formatId The format ID to use for parsing
 * @returns Parsed log line with extracted fields, or null if parsing failed
 */
export function parseLogLine(line: string, formatId: string): ParsedLogLine | null {
    const format = getLogFormatById(formatId);
    if (!format) {
        return null;
    }

    for (const pattern of format.patterns) {
        const match = line.match(pattern);
        if (match && match.groups) {
            const fields = normalizeParsedFields(formatId, { ...match.groups });
            
            return {
                formatId,
                fields,
                raw: line,
            };
        }
    }

    return null;
}

/**
 * Parses a log line using auto-detection to find the best matching format
 * @param line The log line to parse
 * @returns Parsed log line with extracted fields, or null if no format matched
 */
export function parseLogLineAuto(line: string): ParsedLogLine | null {
    const customPatterns = LOG_FORMAT_PATTERNS
        .filter((format) => format.source === 'custom')
        .sort((a, b) => b.priority - a.priority);
    const systemPatterns = LOG_FORMAT_PATTERNS
        .filter((format) => format.source !== 'custom')
        .sort((a, b) => b.priority - a.priority);

    for (const format of [...customPatterns, ...systemPatterns]) {
        for (const pattern of format.patterns) {
            const match = line.match(pattern);
            if (match && match.groups) {
                const fields = normalizeParsedFields(format.id, { ...match.groups });
                
                return {
                    formatId: format.id,
                    fields,
                    raw: line,
                };
            }
        }
    }

    return null;
}

/**
 * Gets field definitions for a specific format
 * @param formatId The format ID to get fields for
 * @returns Array of field definitions, or empty array if format not found
 */
export function getFormatFields(formatId: string): LogFormatField[] {
    const format = getLogFormatById(formatId);
    return format?.fields || [];
}

