import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import OutlinedInput from '@mui/material/OutlinedInput';
import Typography from '@mui/material/Typography';
import FilterListIcon from '@mui/icons-material/FilterList';
import ClearIcon from '@mui/icons-material/Clear';
import CloseIcon from '@mui/icons-material/Close';
import { useEffect, useMemo, useState } from 'react';
import type {
    LogFilters,
    DateRangeFilter,
    TextFilter,
    AnomalyStatusFilterValue,
} from '../types/filters';
import type { LogFormatField } from '../utils/logFormatDetector';

const LOG_LEVEL_OPTIONS = [
    'TRACE',
    'DEBUG',
    'INFO',
    'WARN',
    'WARNING',
    'ERROR',
    'FATAL',
    'CRITICAL',
] as const;

const SECONDARY_DATE_FILTER_FIELDS = new Set([
    'date',
    'time',
    'milliseconds',
    'millisecond',
    'msec',
    'ms',
]);

interface LogFiltersBarProps {
    filters: LogFilters;
    onFiltersChange: (filters: LogFilters) => void;
    fieldDefinitions: LogFormatField[]; // Ordered field definitions from the detected format
    anomalyFilterEnabled: boolean;
    onCloseRequested?: () => void;
}

export const LogFiltersBar: React.FC<LogFiltersBarProps> = ({
    filters,
    onFiltersChange,
    fieldDefinitions,
    anomalyFilterEnabled,
    onCloseRequested,
}) => {
    const [pendingFilters, setPendingFilters] = useState<LogFilters>(filters);

    useEffect(() => {
        setPendingFilters(filters);
    }, [filters]);

    // Get current year
    const currentYear = new Date().getFullYear();
    const minDate = `${currentYear - 30}-01-01T00:00`;
    const maxDate = `${currentYear + 1}-12-31T23:59`;

    // Determine field types based on field definitions
    const isDateTimeField = (field: LogFormatField) => {
        // Any field declared as datetime should render as a date-range control.
        return field.type === 'datetime';
    };

    const isLevelField = (field: LogFormatField) => {
        // Check if field has enum values (for select dropdown)
        return field.enum !== undefined && field.enum.length > 0;
    };

    const visibleFieldDefinitions = useMemo(() => {
        const hasPrimaryTimestampFilter = fieldDefinitions.some((field) => isDateTimeField(field));
        if (!hasPrimaryTimestampFilter) {
            return fieldDefinitions;
        }

        return fieldDefinitions.filter((field) => {
            return !SECONDARY_DATE_FILTER_FIELDS.has(field.name.toLowerCase());
        });
    }, [fieldDefinitions]);

    const sanitizeFilters = (source: LogFilters): LogFilters => {
        const allowedFields = new Set(visibleFieldDefinitions.map((field) => field.name));
        if (anomalyFilterEnabled) {
            allowedFields.add('anomalyStatus');
        }

        const next: LogFilters = {};
        Object.entries(source).forEach(([key, value]) => {
            if (allowedFields.has(key) && value !== undefined) {
                next[key] = value;
            }
        });

        return next;
    };

    const handleTimestampStartChange = (field: string, value: string) => {
        const filterKey = field as keyof LogFilters;
        setPendingFilters({
            ...pendingFilters,
            [filterKey]: {
                ...(pendingFilters[filterKey] as DateRangeFilter),
                start: value ? new Date(value) : null,
            },
        });
    };

    const handleTimestampEndChange = (field: string, value: string) => {
        const filterKey = field as keyof LogFilters;
        setPendingFilters({
            ...pendingFilters,
            [filterKey]: {
                ...(pendingFilters[filterKey] as DateRangeFilter),
                end: value ? new Date(value) : null,
            },
        });
    };

    const handleEnumChange = (field: string, values: string[]) => {
        const filterKey = field as keyof LogFilters;
        setPendingFilters({
            ...pendingFilters,
            [filterKey]: values.length > 0 ? values : undefined,
        });
    };

    const handleTextFilterChange = (field: string, value: string) => {
        setPendingFilters({
            ...pendingFilters,
            [field]: value ? { value } : undefined,
        });
    };

    const handleAnomalyStatusChange = (values: string[]) => {
        setPendingFilters({
            ...pendingFilters,
            anomalyStatus: values.length > 0 ? values as AnomalyStatusFilterValue[] : undefined,
        });
    };

    const handleClearFilters = () => {
        setPendingFilters({});
        onFiltersChange({});
        onCloseRequested?.();
    };

    const handleApplyFilters = () => {
        onFiltersChange(sanitizeFilters(pendingFilters));
        onCloseRequested?.();
    };

    const hasActiveFilters = () => {
        return Object.keys(pendingFilters).some(key => {
            const value = pendingFilters[key];
            if (!value) return false;
            
            if (Array.isArray(value)) return value.length > 0;
            if (typeof value === 'object' && 'value' in value) return !!value.value;
            if (typeof value === 'object' && ('start' in value || 'end' in value)) {
                return !!(value.start || value.end);
            }
            return false;
        });
    };

    const getActiveFiltersCount = () => {
        return Object.keys(pendingFilters).filter(key => {
            const value = pendingFilters[key];
            if (!value) return false;
            
            if (Array.isArray(value)) return value.length > 0;
            if (typeof value === 'object' && 'value' in value) return !!value.value;
            if (typeof value === 'object' && ('start' in value || 'end' in value)) {
                return !!(value.start || value.end);
            }
            return false;
        }).length;
    };

    // Convert Date to datetime-local format
    const formatDateTimeLocal = (date: Date | null | undefined) => {
        if (!date) return '';
        const d = new Date(date);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
    };

    // Get field label from field name (capitalize first letter)
    const getFieldLabel = (field: LogFormatField): string => {
        return field.name.charAt(0).toUpperCase() + field.name.slice(1);
    };

    // Render filter for a single field based on its type
    const renderFieldFilter = (field: LogFormatField) => {
        const fieldName = field.name;

        // Date/Time range filter
        if (isDateTimeField(field)) {
            const filterValue = pendingFilters[fieldName as keyof LogFilters] as DateRangeFilter | undefined;
            return (
                <div
                    key={fieldName}
                    style={{ display: 'contents' }}
                >
                    <TextField
                        label={`${getFieldLabel(field)} (Start)`}
                        type="datetime-local"
                        value={formatDateTimeLocal(filterValue?.start)}
                        onChange={(e) => handleTimestampStartChange(fieldName, e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        inputProps={{ min: minDate, max: maxDate }}
                        size="small"
                        sx={{ minWidth: 220 }}
                    />
                    <TextField
                        label={`${getFieldLabel(field)} (End)`}
                        type="datetime-local"
                        value={formatDateTimeLocal(filterValue?.end)}
                        onChange={(e) => handleTimestampEndChange(fieldName, e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        inputProps={{ min: minDate, max: maxDate }}
                        size="small"
                        sx={{ minWidth: 220 }}
                    />
                </div>
            );
        }

        // Enum filter (multi-select) - for any field with enum values
        if (isLevelField(field)) {
            const enumOptions = field.enum || LOG_LEVEL_OPTIONS;
            const filterValue = pendingFilters[fieldName as keyof LogFilters] as string[] | undefined;
            
            return (
                <FormControl
                    key={fieldName}
                    size="small"
                    sx={{ minWidth: 200 }}
                >
                    <InputLabel>{getFieldLabel(field)}</InputLabel>
                    <Select
                        multiple
                        value={filterValue || []}
                        onChange={(e) => handleEnumChange(fieldName, e.target.value as string[])}
                        input={<OutlinedInput label={getFieldLabel(field)} />}
                        renderValue={(selected) => (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {selected.map((value) => (
                                    <Chip
                                        key={value}
                                        label={value}
                                        size="small"
                                    />
                                ))}
                            </Box>
                        )}
                    >
                        {enumOptions.map((option) => (
                            <MenuItem
                                key={option}
                                value={option}
                            >
                                {option}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            );
        }

        // Text filter (for all other fields)
        const filterValue = pendingFilters[fieldName as keyof LogFilters] as TextFilter | undefined;
        return (
            <TextField
                key={fieldName}
                label={getFieldLabel(field)}
                value={filterValue?.value || ''}
                onChange={(e) => handleTextFilterChange(fieldName, e.target.value)}
                size="small"
                sx={{ minWidth: 200 }}
                placeholder={`Search in ${fieldName}...`}
            />
        );
    };

    const renderAnomalyFilter = () => {
        const filterValue = pendingFilters.anomalyStatus as AnomalyStatusFilterValue[] | undefined;

        return (
            <FormControl
                key="anomalyStatus"
                size="small"
                sx={{ minWidth: 220 }}
                disabled={!anomalyFilterEnabled}
            >
                <InputLabel>Аномалии</InputLabel>
                <Select
                    multiple
                    value={filterValue || []}
                    onChange={(e) => handleAnomalyStatusChange(e.target.value as string[])}
                    input={<OutlinedInput label="Аномалии" />}
                    renderValue={(selected) => (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {selected.map((value) => (
                                <Chip
                                    key={value}
                                    label={value === 'anomaly'
                                        ? 'Аномалии'
                                        : value === 'normal'
                                            ? 'Нормальные'
                                            : 'Неопределенные'}
                                    size="small"
                                />
                            ))}
                        </Box>
                    )}
                >
                    <MenuItem value="anomaly">Аномалии</MenuItem>
                    <MenuItem value="normal">Нормальные</MenuItem>
                    <MenuItem value="undefined">Неопределенные</MenuItem>
                </Select>
            </FormControl>
        );
    };

    const header = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <FilterListIcon />
            <Typography>Filters</Typography>
            {hasActiveFilters() && (
                <Chip
                    label={getActiveFiltersCount()}
                    size="small"
                    color="primary"
                />
            )}
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {onCloseRequested && (
                    <IconButton
                        size="small"
                        aria-label="close"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCloseRequested();
                        }}
                    >
                        <CloseIcon fontSize="small" />
                    </IconButton>
                )}
                </Box>
        </Box>
    );

    const isNoFilterState = visibleFieldDefinitions.length === 0 && !anomalyFilterEnabled;

    const content = (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {isNoFilterState ? (
                <Typography
                    variant="body2"
                    color="text.secondary"
                >
                    Фильтрация для неопознанного формата невозможна.
                    <br />
                    Выберите один из доступных форматов или создайте свой собственный.
                </Typography>
            ) : (
                <>
                    {visibleFieldDefinitions.map(field => renderFieldFilter(field))}
                    {renderAnomalyFilter()}
                    <Box sx={{ display: 'flex', gap: 1, width: '100%', justifyContent: 'flex-end' }}>
                        {hasActiveFilters() && (
                            <Chip
                                label="Clear All"
                                variant="outlined"
                                onClick={handleClearFilters}
                                clickable
                                icon={<ClearIcon fontSize="small" />}
                                sx={{ height: 32 }}
                            />
                        )}
                        <Chip
                            label="Apply"
                            color="primary"
                            onClick={handleApplyFilters}
                            clickable
                            sx={{ height: 32 }}
                        />
                    </Box>
                </>
            )}
        </Box>
    );

    return (
        <Box sx={{ p: 1.5, maxWidth: 720 }}>
            {header}
            <Box sx={{ mt: 1.5 }}>
                {content}
            </Box>
        </Box>
    );
};
