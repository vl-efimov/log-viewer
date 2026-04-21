import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import WarningIcon from '@mui/icons-material/Warning';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface UnknownFormatConfirmDialogProps {
    open: boolean;
    fileName: string;
    fileSize: number;
    previewText: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const UnknownFormatConfirmDialog: React.FC<UnknownFormatConfirmDialogProps> = ({
    open,
    fileName,
    onConfirm,
    onCancel,
}) => {
    return (
        <Dialog
            open={open}
            onClose={onCancel}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    maxWidth: 500,
                },
            }}
        >
            <DialogContent sx={{ pt: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                    <WarningIcon color="warning" sx={{ mt: 0.5 }} />
                    <Typography variant="body1">
                        Формат логов для файла {fileName} не определен. Хотите добавить собственный формат?
                    </Typography>
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={onCancel} variant="outlined">
                    Отмена
                </Button>
                <Button onClick={onConfirm} variant="contained" autoFocus>
                    OK
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default UnknownFormatConfirmDialog;
