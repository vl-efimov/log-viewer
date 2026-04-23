import React, { useCallback } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { enqueueNotification } from '../../redux/slices/notificationsSlice';

interface RegexHighlighterProps {
    pattern: string;
}

/**
 * Component for syntax highlighting of regular expressions
 * Colors similar to VS Code regex highlighting
 */
const RegexHighlighter: React.FC<RegexHighlighterProps> = ({ pattern }) => {
    const dispatch = useDispatch();
    const { t } = useTranslation();

    const copyPatternToClipboard = useCallback(async () => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(pattern);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = pattern;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const copied = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (!copied) {
                    throw new Error('Copy command failed');
                }
            }

            dispatch(enqueueNotification({
                message: t('clipboard.copied'),
                severity: 'success',
                autoHideDuration: 2500,
            }));
        } catch {
            dispatch(enqueueNotification({
                message: t('clipboard.copyFailed'),
                severity: 'error',
            }));
        }
    }, [dispatch, pattern, t]);

    const tokenize = (regex: string): Array<{ text: string; type: string }> => {
        const tokens: Array<{ text: string; type: string }> = [];
        let i = 0;

        while (i < regex.length) {
            const char = regex[i];

            // Named capture groups: (?<name>...)
            if (regex.substring(i, i + 3) === '(?<') {
                const endBracket = regex.indexOf('>', i + 3);
                if (endBracket !== -1) {
                    tokens.push({ text: '(?<', type: 'group' });
                    tokens.push({ text: regex.substring(i + 3, endBracket), type: 'name' });
                    tokens.push({ text: '>', type: 'group' });
                    i = endBracket + 1;
                    continue;
                }
            }

            // Non-capturing groups: (?: or (?= or (?! or (?<=  or (?<!
            if (regex.substring(i, i + 2) === '(?' || regex.substring(i, i + 3) === '(?:' || 
                regex.substring(i, i + 3) === '(?=' || regex.substring(i, i + 3) === '(?!' ||
                regex.substring(i, i + 4) === '(?<=' || regex.substring(i, i + 4) === '(?<!') {
                let end = i + 2;
                while (end < regex.length && regex[end] !== ')' && regex[end] !== '(') {
                    if (regex[end] === ':' || regex[end] === '=' || regex[end] === '!') {
                        end++;
                        break;
                    }
                    end++;
                }
                tokens.push({ text: regex.substring(i, end), type: 'group' });
                i = end;
                continue;
            }

            // Capturing groups: (
            if (char === '(' || char === ')') {
                tokens.push({ text: char, type: 'group' });
                i++;
                continue;
            }

            // Character classes: [...]
            if (char === '[') {
                let j = i + 1;
                let escaped = false;
                while (j < regex.length) {
                    if (regex[j] === '\\' && !escaped) {
                        escaped = true;
                    } else if (regex[j] === ']' && !escaped) {
                        break;
                    } else {
                        escaped = false;
                    }
                    j++;
                }
                tokens.push({ text: regex.substring(i, j + 1), type: 'charclass' });
                i = j + 1;
                continue;
            }

            // Escape sequences: \d, \w, \s, \., etc.
            if (char === '\\' && i + 1 < regex.length) {
                tokens.push({ text: regex.substring(i, i + 2), type: 'escape' });
                i += 2;
                continue;
            }

            // Quantifiers: *, +, ?, {n}, {n,}, {n,m}
            if (char === '*' || char === '+' || char === '?') {
                tokens.push({ text: char, type: 'quantifier' });
                i++;
                continue;
            }

            if (char === '{') {
                let j = i + 1;
                while (j < regex.length && regex[j] !== '}') {
                    j++;
                }
                if (j < regex.length) {
                    tokens.push({ text: regex.substring(i, j + 1), type: 'quantifier' });
                    i = j + 1;
                    continue;
                }
            }

            // Anchors: ^, $
            if (char === '^' || char === '$') {
                tokens.push({ text: char, type: 'anchor' });
                i++;
                continue;
            }

            // Alternation: |
            if (char === '|') {
                tokens.push({ text: char, type: 'alternation' });
                i++;
                continue;
            }

            // Dot: .
            if (char === '.') {
                tokens.push({ text: char, type: 'dot' });
                i++;
                continue;
            }

            // Regular characters
            tokens.push({ text: char, type: 'text' });
            i++;
        }

        return tokens;
    };

    const tokens = tokenize(pattern);

    const getColor = (type: string, isDark: boolean): string => {
        // VS Code-like colors
        if (isDark) {
            switch (type) {
                case 'group': return '#569cd6'; // Blue for groups
                case 'name': return '#4ec9b0'; // Cyan for group names
                case 'charclass': return '#ce9178'; // Orange for character classes
                case 'escape': return '#d7ba7d'; // Yellow for escape sequences
                case 'quantifier': return '#b5cea8'; // Light green for quantifiers
                case 'anchor': return '#c586c0'; // Purple for anchors
                case 'alternation': return '#d16969'; // Red for alternation
                case 'dot': return '#dcdcaa'; // Yellow for dot
                default: return '#d4d4d4'; // Light gray for text
            }
        } else {
            switch (type) {
                case 'group': return '#0000ff'; // Blue for groups
                case 'name': return '#008080'; // Cyan for group names
                case 'charclass': return '#a31515'; // Red for character classes
                case 'escape': return '#795e26'; // Brown for escape sequences
                case 'quantifier': return '#098658'; // Green for quantifiers
                case 'anchor': return '#af00db'; // Purple for anchors
                case 'alternation': return '#d16969'; // Red for alternation
                case 'dot': return '#795e26'; // Brown for dot
                default: return '#000000'; // Black for text
            }
        }
    };

    return (
        <Box
            component="pre"
            sx={{
                position: 'relative',
                fontFamily: '"Consolas", "Courier New", monospace',
                fontSize: '0.85em',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
                margin: 0,
                p: 1,
                pr: 5,
                backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#f5f5f5',
                borderRadius: 1,
                lineHeight: 1.4,
                '& .regex-copy-button': {
                    opacity: 0,
                    pointerEvents: 'none',
                    transition: 'opacity 0.15s ease',
                },
                '&:hover .regex-copy-button, &:focus-within .regex-copy-button': {
                    opacity: 1,
                    pointerEvents: 'auto',
                },
            }}
        >
            <Tooltip
                title={t('clipboard.copy')}
                arrow
            >
                <IconButton
                    size="small"
                    className="regex-copy-button"
                    onClick={(event) => {
                        const target = event.currentTarget;
                        event.stopPropagation();
                        void copyPatternToClipboard().finally(() => {
                            target.blur();
                        });
                    }}
                    sx={{
                        position: 'absolute',
                        top: 3,
                        right: 3,
                        width: 20,
                        height: 20,
                        p: 0.25,
                        bgcolor: (theme) => theme.palette.background.paper,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        '&:hover': {
                            bgcolor: (theme) => theme.palette.action.hover,
                        },
                    }}
                >
                    <ContentCopyIcon sx={{ fontSize: 12 }} />
                </IconButton>
            </Tooltip>
            {tokens.map((token, index) => (
                <Box
                    key={index}
                    component="span"
                    sx={{
                        color: (theme) => getColor(token.type, theme.palette.mode === 'dark'),
                        fontWeight: ['group', 'name', 'anchor'].includes(token.type) ? 'bold' : 'normal',
                    }}
                >
                    {token.text}
                </Box>
            ))}
        </Box>
    );
};

export default RegexHighlighter;
