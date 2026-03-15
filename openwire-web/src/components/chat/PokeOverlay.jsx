import { memo, useEffect } from 'react';
import '../../styles/poke.css';

const POKE_TYPES = {
    snowball: { emoji: '\u2744\uFE0F', label: 'Snowball' },
    siren:   { emoji: '\uD83D\uDEA8', label: 'Siren' },
    wave:    { emoji: '\uD83D\uDC4B', label: 'Wave' },
    heart:   { emoji: '\uD83D\uDC96', label: 'Heart' },
    thunder: { emoji: '\u26A1', label: 'Thunder' },
    confetti:{ emoji: '\uD83C\uDF89', label: 'Confetti' },
};

function PokeOverlay({ poke, onDone }) {
    const pokeData = POKE_TYPES[poke.poke_type] || POKE_TYPES.wave;
    useEffect(() => {
        const timer = setTimeout(onDone, 2500);
        return () => clearTimeout(timer);
    }, [onDone]);

    return (
        <div className={`poke-overlay poke-${poke.poke_type}`} onClick={onDone}>
            <div className="poke-emoji">{pokeData.emoji}</div>
            <div className="poke-label">{poke.from_nick} poked you!</div>
        </div>
    );
}

export default memo(PokeOverlay);
