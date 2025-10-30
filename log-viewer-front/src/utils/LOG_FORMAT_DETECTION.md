# Log Format Detection System

## Overview

The log format detection system has been refactored to separate configuration from code logic. This makes it easier to maintain, extend, and customize log format detection.

## Structure

### 1. **Core Module**: `src/utils/logFormatDetector.ts`
- Contains the detection logic
- Defines TypeScript interfaces
- Provides API for format registration and detection

### 2. **Configuration File**: `public/log-formats.json` (Optional)
- JSON-based format definitions
- Can be edited without code changes
- Easy for non-developers to modify

## Usage

### Basic Usage

```typescript
import { detectLogFormat } from '@/utils/logFormatDetector';

const logContent = "..."; // Your log file content
const format = detectLogFormat(logContent);
console.log(`Detected format: ${format}`);
```

### Parse Individual Log Lines

```typescript
import { parseLogLine, parseLogLineAuto } from '@/utils/logFormatDetector';

// Parse with specific format
const line = "2025-10-30 12:34:56,789 INFO org.example.MyClass: Starting application";
const parsed = parseLogLine(line, 'hdfs-v2');

if (parsed) {
  console.log('Timestamp:', parsed.fields.timestamp);  // "2025-10-30 12:34:56,789"
  console.log('Level:', parsed.fields.level);          // "INFO"
  console.log('Class:', parsed.fields.class);          // "org.example.MyClass"
  console.log('Message:', parsed.fields.message);      // "Starting application"
}

// Auto-detect format and parse
const autoParsed = parseLogLineAuto(line);
console.log('Detected format:', autoParsed?.formatId);
```

### Get Field Definitions

```typescript
import { getFormatFields } from '@/utils/logFormatDetector';

const fields = getFormatFields('nginx');
fields.forEach(field => {
  console.log(`${field.name}: ${field.description} (${field.type})`);
});

// Output:
// ip: Client IP address (string)
// user: Authenticated username (string)
// timestamp: Request timestamp (datetime)
// method: HTTP method (string)
// ...
```

### Get All Available Formats

```typescript
import { getAvailableLogFormats } from '@/utils/logFormatDetector';

const formats = getAvailableLogFormats();
formats.forEach(format => {
  console.log(`${format.name}: ${format.description}`);
});
```

### Register Custom Format

```typescript
import { registerCustomLogFormat } from '@/utils/logFormatDetector';

registerCustomLogFormat({
  id: 'custom-format',
  name: 'My Custom Format',
  description: 'Custom application log format',
  priority: 95,
  patterns: [
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[.*\]/m
  ],
  validate: (content) => {
    // Optional custom validation logic
    return content.includes('MyApp');
  }
});
```

## Adding New Formats

### Method 1: Edit TypeScript Configuration

Edit `src/utils/logFormatDetector.ts` and add to `LOG_FORMAT_PATTERNS`:

```typescript
{
  id: 'my-format',
  name: 'My Log Format',
  description: 'Description of the format',
  priority: 70,
  patterns: [
    /^(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}) \[(?<level>\w+)\] (?<message>.*)/m
  ],
  fields: [
    { name: 'timestamp', description: 'ISO timestamp', type: 'datetime' },
    { name: 'level', description: 'Log level', type: 'string' },
    { name: 'message', description: 'Log message', type: 'string' },
  ],
  validate: (content) => {
    // Optional: Additional validation
    return true;
  }
}
```

### Method 2: Edit JSON Configuration

Edit `public/log-formats.json`:

```json
{
  "id": "my-format",
  "name": "My Log Format",
  "description": "Description of the format",
  "priority": 70,
  "patterns": [
    "^(?<timestamp>\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}) \\[(?<level>\\w+)\\] (?<message>.*)"
  ],
  "fields": [
    {
      "name": "timestamp",
      "description": "ISO timestamp",
      "type": "datetime"
    },
    {
      "name": "level",
      "description": "Log level",
      "type": "string"
    },
    {
      "name": "message",
      "description": "Log message",
      "type": "string"
    }
  ]
}
```

## Format Priority

Formats are checked in **descending priority order**:
- **100+**: Highly specific formats (e.g., Apache Error)
- **80-99**: Specific formats with unique structure
- **60-79**: Common formats
- **50-59**: Generic/fallback formats

## Benefits of New Structure

✅ **Separation of Concerns**: Logic separated from configuration
✅ **Easy Maintenance**: Add/modify formats without touching core code
✅ **Type Safety**: TypeScript interfaces ensure correct format definition
✅ **Extensibility**: Plugin-like system for custom formats
✅ **Documentation**: Self-documenting with descriptions
✅ **Testability**: Easy to test individual format patterns
✅ **Priority System**: Control detection order explicitly

## Pattern Tips

1. **Use named capture groups**: `(?<fieldName>pattern)` to extract structured data
2. **Use multiline flag** (`/pattern/m`) for line-start anchors
3. **Be specific**: More specific patterns should have higher priority
4. **Test thoroughly**: Use sample logs to verify patterns
5. **Document fields**: Always add field definitions with descriptions and types
6. **Validate edge cases**: Use `validate` function for complex logic

## Field Types

- **`string`**: Text data (usernames, messages, etc.)
- **`number`**: Numeric values (status codes, bytes, PIDs)
- **`datetime`**: Full date and time
- **`date`**: Date only
- **`time`**: Time only
- **`duration`**: Time duration (e.g., HH:MM:SS)

## Example Formats with Named Capture Groups

### Apache Error Log
```regex
^\[(?<timestamp>.*?)\] \[(?<level>[a-z]+)\](?: \[client (?<client>[^\]]+)\])?(?: (?<message>.*))?$
```
**Fields**: `timestamp`, `level`, `client`, `message`

### HDFS v2
```regex
^(?<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}) (?<level>INFO|WARN|ERROR|DEBUG|TRACE|FATAL) (?<class>[\w.$:-]+): ?(?<message>.*)
```
**Fields**: `timestamp`, `level`, `class`, `message`

### Nginx Access Log
```regex
^(?<ip>\S+) - (?<user>\S+) \[(?<timestamp>\d{2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})\] "(?<method>\w+) (?<path>\S+) (?<protocol>HTTP/[\d.]+)" (?<status>\d{3}) (?<bytes>\d+) "(?<referer>[^"]*)" "(?<userAgent>[^"]*)"
```
**Fields**: `ip`, `user`, `timestamp`, `method`, `path`, `protocol`, `status`, `bytes`, `referer`, `userAgent`

### Syslog
```regex
^(?<month>\w{3}) +(?<day>\d{1,2}) (?<time>\d{2}:\d{2}:\d{2}) (?<hostname>\S+) (?<process>\S+?)(?:\[(?<pid>\d+)\])?: ?(?<message>.*)
```
**Fields**: `month`, `day`, `time`, `hostname`, `process`, `pid` (optional), `message`

## Future Enhancements

- [ ] Load formats from external API
- [ ] User-defined formats in settings
- [ ] Format auto-learning based on user feedback
- [ ] Import/export format configurations
- [ ] Visual format pattern builder
