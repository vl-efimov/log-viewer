/**
 * Example usage of the log format detection and parsing system
 */

import { 
    detectLogFormat, 
    parseLogLine, 
    parseLogLineAuto,
    getFormatFields,
    getAvailableLogFormats,
    type ParsedLogLine 
} from './logFormatDetector';

// ========================================
// Example 1: Detect format from file content
// ========================================
function exampleDetectFormat() {
    const apacheLog = `[Mon Oct 30 12:34:56 2025] [error] [client 192.168.1.100] File does not exist: /var/www/html/missing.html`;
    const format = detectLogFormat(apacheLog);
    console.log('Detected format:', format); // "Apache Error Log"
}

// ========================================
// Example 2: Parse a single log line
// ========================================
function exampleParseLogLine() {
    const hdfsLog = "2025-10-30 12:34:56,789 INFO org.apache.hadoop.ipc.Server: Starting server";
    const parsed = parseLogLine(hdfsLog, 'hdfs-v2');
    
    if (parsed) {
        console.log('Format:', parsed.formatId);
        console.log('Timestamp:', parsed.fields.timestamp);
        console.log('Level:', parsed.fields.level);
        console.log('Class:', parsed.fields.class);
        console.log('Message:', parsed.fields.message);
    }
}

// ========================================
// Example 3: Auto-detect and parse
// ========================================
function exampleAutoDetectParse() {
    const nginxLog = `192.168.1.100 - john [30/Oct/2025:12:34:56 +0000] "GET /api/users HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"`;
    const parsed = parseLogLineAuto(nginxLog);
    
    if (parsed) {
        console.log('Auto-detected format:', parsed.formatId);
        console.log('IP:', parsed.fields.ip);
        console.log('Method:', parsed.fields.method);
        console.log('Status:', parsed.fields.status);
        console.log('User Agent:', parsed.fields.userAgent);
    }
}

// ========================================
// Example 4: Get field definitions
// ========================================
function exampleGetFields() {
    const fields = getFormatFields('syslog');
    
    console.log('Syslog format fields:');
    fields.forEach(field => {
        const optional = field.optional ? ' (optional)' : '';
        console.log(`  - ${field.name}: ${field.description} [${field.type}]${optional}`);
    });
}

// ========================================
// Example 5: Process multiple log lines
// ========================================
function exampleProcessMultipleLines() {
    const logContent = `
2025-10-30 10:00:00,123 INFO org.example.App: Application started
2025-10-30 10:00:05,456 WARN org.example.Database: Connection pool low
2025-10-30 10:00:10,789 ERROR org.example.API: Request failed
    `.trim();
    
    const lines = logContent.split('\n');
    const parsedLines: ParsedLogLine[] = [];
    
    for (const line of lines) {
        const parsed = parseLogLineAuto(line);
        if (parsed) {
            parsedLines.push(parsed);
        }
    }
    
    // Group by log level
    const byLevel = parsedLines.reduce((acc, line) => {
        const level = line.fields.level || 'UNKNOWN';
        acc[level] = (acc[level] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    
    console.log('Log entries by level:', byLevel);
}

// ========================================
// Example 6: List all available formats
// ========================================
function exampleListFormats() {
    const formats = getAvailableLogFormats();
    
    console.log('Available log formats:');
    formats
        .sort((a, b) => b.priority - a.priority)
        .forEach(format => {
            console.log(`  [${format.id}] ${format.name} (priority: ${format.priority})`);
            console.log(`      ${format.description}`);
            if (format.fields) {
                console.log(`      Fields: ${format.fields.map(f => f.name).join(', ')}`);
            }
        });
}

// ========================================
// Example 7: Extract specific fields from logs
// ========================================
function exampleExtractFields() {
    const apacheAccessLog = `192.168.1.100 - frank [30/Oct/2025:12:34:56 +0000] "POST /api/login HTTP/1.1" 401 0`;
    const parsed = parseLogLine(apacheAccessLog, 'apache-access');
    
    if (parsed) {
        // Extract only failed authentication attempts (401)
        if (parsed.fields.status === '401') {
            console.log('Failed login attempt:');
            console.log('  IP:', parsed.fields.ip);
            console.log('  User:', parsed.fields.user);
            console.log('  Path:', parsed.fields.path);
            console.log('  Time:', parsed.fields.timestamp);
        }
    }
}

// ========================================
// Example 8: Validate log format structure
// ========================================
function exampleValidateStructure() {
    const testLine = "2025-10-30 12:34:56 JOB 12345 USER=alice QUEUE=high NODES=64 CORES=128 RUNTIME=01:23:45 STATUS=COMPLETED";
    const parsed = parseLogLine(testLine, 'bgl-new');
    
    if (parsed) {
        const fields = getFormatFields('bgl-new');
        const requiredFields = fields.filter(f => !f.optional).map(f => f.name);
        const missingFields = requiredFields.filter(name => !parsed.fields[name]);
        
        if (missingFields.length === 0) {
            console.log('✓ All required fields present');
            console.log('Job details:');
            console.log('  Job ID:', parsed.fields.jobId);
            console.log('  User:', parsed.fields.user);
            console.log('  Nodes:', parsed.fields.nodes);
            console.log('  Runtime:', parsed.fields.runtime);
            console.log('  Status:', parsed.fields.status);
        } else {
            console.log('✗ Missing required fields:', missingFields);
        }
    }
}

// Export examples for testing
export {
    exampleDetectFormat,
    exampleParseLogLine,
    exampleAutoDetectParse,
    exampleGetFields,
    exampleProcessMultipleLines,
    exampleListFormats,
    exampleExtractFields,
    exampleValidateStructure,
};
