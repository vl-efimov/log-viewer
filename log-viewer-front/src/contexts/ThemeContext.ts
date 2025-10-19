
import React from 'react';
import { ColorModeEnum } from '../constants/ColorModeEnum';

export interface ThemeContextProps {
    mode: ColorModeEnum;
    toggleTheme: () => void;
    primaryColor: string;
    setPrimaryColor: (color: string) => void;
}

export const ThemeContext = React.createContext<ThemeContextProps>({
    mode: ColorModeEnum.Dark,
    toggleTheme: () => {},
    primaryColor: '#1976d2',
    setPrimaryColor: () => {},
});
