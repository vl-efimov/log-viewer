import { useState, useEffect } from 'react';

interface FlagProps {
    language: string;
    [key: string]: unknown;
}

const Flag: React.FC<FlagProps> = (props: FlagProps) => {
    const [flag, setFlag] = useState<string | null>(null);

    useEffect(() => {
        const loadFlag = async () => {
            try {
                const flagResponse = await import(`../assets/flags/${props.language}-flag.svg`);
                setFlag(flagResponse.default);
            } catch (e) {
                console.error(`Error loading flag for ${props.language}:`, e);
            }
        };

        loadFlag();
    }, [props.language]);

    return flag ? <img src={flag} alt={`${props.language} flag`} {...props} /> : null;
};

export default Flag;
