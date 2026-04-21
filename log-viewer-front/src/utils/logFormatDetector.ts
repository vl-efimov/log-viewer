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

function normalizeParsedFields(formatId: string, rawFields: Record<string, string>): Record<string, string> {
    const fields = { ...rawFields };

    // Special handling for syslog: combine month, day, time into timestamp.
    if (formatId === 'syslog' && fields.month && fields.day && fields.time) {
        const currentYear = new Date().getFullYear();
        const monthMap: Record<string, string> = {
            'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
            'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
            'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
        };
        const month = monthMap[fields.month] || '01';
        const day = fields.day.padStart(2, '0');
        fields.timestamp = `${currentYear}-${month}-${day} ${fields.time}`;
    }

    // Special handling for HDFS v1: combine date (YYMMDD), time (HHMMSS), optional milliseconds.
    if (formatId === 'hdfs-v1' && fields.date && fields.time) {
        const yy = fields.date.substring(0, 2);
        const mm = fields.date.substring(2, 4);
        const dd = fields.date.substring(4, 6);
        const year = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;

        const hh = fields.time.substring(0, 2);
        const min = fields.time.substring(2, 4);
        const ss = fields.time.substring(4, 6);

        const msRaw = (fields.milliseconds || fields.ms || '').trim();
        if (msRaw) {
            const ms = msRaw.padStart(3, '0').slice(0, 3);
            fields.timestamp = `${year}-${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
        } else {
            fields.timestamp = `${year}-${mm}-${dd} ${hh}:${min}:${ss}`;
        }
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

        return {
            id: format.id,
            name: format.name,
            description: format.description,
            priority: CUSTOM_FORMAT_PRIORITY,
            patterns: [new RegExp(format.regex, 'm')],
            source: 'custom',
            fields: groups.map((group) => ({
                name: group,
                description: `Custom field: ${group}`,
                type: getFieldType(group),
            })),
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

