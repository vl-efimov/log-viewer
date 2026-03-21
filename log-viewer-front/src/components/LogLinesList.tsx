import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type FC, type RefObject } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

interface DisplayLine {
    displayLineNumber: number;
    raw: string;
}

interface LogLinesListProps {
    displayLines: DisplayLine[];
    selectedLine: number | null;
    onSelectLine: (lineNumber: number) => void;
    virtuosoRef: RefObject<VirtuosoHandle | null>;
}

const LogLinesList: FC<LogLinesListProps> = ({
    displayLines,
    selectedLine,
    onSelectLine,
    virtuosoRef,
}) => {
    return (
        <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%', width: '100%' }}
            totalCount={displayLines.length}
            overscan={200}
            fixedItemHeight={20}
            computeItemKey={(index) => {
                return displayLines[index]?.displayLineNumber || index;
            }}
            itemContent={(index) => {
                const row = displayLines[index];
                if (!row) {
                    console.warn(`Missing row at index ${index}, total: ${displayLines.length}`);
                    return null;
                }

                return (
                    <Box
                        sx={{
                            display: 'flex',
                            height: '20px',
                            alignItems: 'center',
                            px: 2,
                            cursor: 'pointer',
                            backgroundColor: selectedLine === row.lineNumber ? '#e3f2fd' : 'transparent',
                            '&:hover': {
                                backgroundColor: selectedLine === row.lineNumber ? '#e3f2fd' : (theme) => theme.palette.action.hover,
                            },
                        }}
                        onClick={() => onSelectLine(row.displayLineNumber)}
                    >
                        <Typography
                            variant="body2"
                            sx={{
                                minWidth: '80px',
                                color: 'text.secondary',
                                fontFamily: 'monospace',
                                fontSize: '0.8rem',
                                lineHeight: '20px',
                                userSelect: 'none',
                                mr: 2,
                                flexShrink: 0,
                            }}
                        >
                            {row.displayLineNumber}
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.8rem',
                                lineHeight: '20px',
                                flex: 1,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {row.raw}
                        </Typography>
                    </Box>
                );
            }}
        />
    );
};

export default LogLinesList;
