import IconButton from '@mui/material/IconButton';
import Slide from '@mui/material/Slide';
import LightMode from '@mui/icons-material/LightMode';
import DarkMode from '@mui/icons-material/DarkMode';
import { ColorModeEnum } from '../constants/ColorModeEnum';

interface ThemeToggleButtonProps {
    mode: ColorModeEnum;
    toggleTheme: () => void;
}

const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({ mode, toggleTheme }) => (
    <IconButton
        onClick={toggleTheme}
        color="inherit"
        sx={{
            position: 'relative',
            width: 40,
            height: 40,
            overflow: 'hidden',
        }}
    >
        <Slide
            direction="right"
            in={mode === ColorModeEnum.Dark}
            mountOnEnter
            unmountOnExit
            timeout={300}
            appear={false}
        >
            <span
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: 40,
                    height: 40,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                <LightMode />
            </span>
        </Slide>
        <Slide
            direction="left"
            in={mode !== ColorModeEnum.Dark}
            mountOnEnter
            unmountOnExit
            timeout={300}
            appear={false}
        >
            <span
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: 40,
                    height: 40,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                <DarkMode />
            </span>
        </Slide>
    </IconButton>
);

export default ThemeToggleButton;
