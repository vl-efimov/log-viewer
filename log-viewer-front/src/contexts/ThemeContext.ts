import { createContext } from 'react';
import { ColorModeEnum } from '../constants/ColorModeEnum';

export interface ThemeContextType {
    toggleTheme: () => void;
    mode: ColorModeEnum;
}

export const ThemeContext = createContext<ThemeContextType>({
    toggleTheme: () => { },
    mode: ColorModeEnum.Dark,
});
