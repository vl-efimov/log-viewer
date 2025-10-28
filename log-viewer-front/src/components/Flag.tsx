import gbFlag from '../assets/flags/gb-flag.svg';
import ruFlag from '../assets/flags/ru-flag.svg';
import czFlag from '../assets/flags/cz-flag.svg';
import { Languages } from '../constants/LanguagesEnum';

interface FlagProps {
    language: string;
    [key: string]: unknown;
}

const FLAG_MAP: Record<string, string> = {
    gb: gbFlag,
    ru: ruFlag,
    cz: czFlag,
};

const Flag: React.FC<FlagProps> = (props: FlagProps) => {
    const code = props.language === Languages.EN ? 'gb' : props.language;
    const src = FLAG_MAP[code];
    if (!src) return null;
    return <img src={src} alt={`${props.language} flag`} {...props} />;
};

export default Flag;
