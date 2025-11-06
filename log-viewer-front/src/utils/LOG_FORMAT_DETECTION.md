# Log Format Detection System

## Overview

The log format detection system loads all format definitions from a JSON configuration file (`public/log-formats.json`). This makes it easy to add, modify, or remove log formats without changing the code.

## Structure

### 1. **Core Module**: `src/utils/logFormatDetector.ts`
- Contains the detection and parsing logic
- Defines TypeScript interfaces
- Loads formats from JSON at application startup
- Provides API for format detection and parsing

### 2. **Configuration File**: `public/log-formats.json`
- JSON-based format definitions (the single source of truth)
- Can be edited without code changes
- Contains all regex patterns and field definitions

## How It Works

1. **Application Startup**: When the app starts, `initializeLogFormats()` is called in `main.tsx`
2. **JSON Loading**: The function fetches `/log-formats.json` and converts string patterns to RegExp objects
3. **Format Detection**: All detection and parsing functions use the loaded formats from JSON

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
  console.log('Timestamp:', parsed.fields.timestamp);
  console.log('Level:', parsed.fields.level);
  console.log('Class:', parsed.fields.class);
  console.log('Message:', parsed.fields.message);
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
```

### Get All Available Formats

```typescript
import { getAvailableLogFormats } from '@/utils/logFormatDetector';

const formats = getAvailableLogFormats();
formats.forEach(format => {
  console.log(`${format.name}: ${format.description}`);
});
```

## Adding New Formats

Edit `public/log-formats.json` and add a new format object:

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
