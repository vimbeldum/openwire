const fs = require('fs');
const content = fs.readFileSync('src/components/RouletteBoard.jsx', 'utf8');

const targetStr = `    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="rl-table">`;

const parts = content.split(targetStr);
if (parts.length < 2) {
    console.error("Could not find start block");
    process.exit(1);
}

const beforeReturn = parts[0];

const newReturn = `    return (
        <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
            <div className="rl-table">

                {/* ── Header ── */}
                <div className="game-table-header">
                    <div className="game-table-title">
                        🎰 <span>Roulette</span>
                        {isHost && <span className="host-crown" title="You are driving the wheel">👑</span>}
                    </div>
                    <div className="game-table-meta">
                        {wallet && <span className="chip-display">💰 {balance.toLocaleString()}</span>}
                        <Countdown nextSpinAt={game.nextSpinAt} phase={game.phase} />
                    </div>
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                {/* ── Two-column body: wheel left, betting right ── */}
                <div className="rl-body">
                    {/* LEFT: Wheel + result + history */}
                    <div className="rl-left-col">
                        <div className="rl-wheel-section" style={{ minHeight: '340px' }}>
                            <RouletteWheel spinning={spinning} result={game.result} />
                        </div>
                        
                        <div className="rl-wheel-info" style={{ marginTop: '1rem' }}>
                            {game.phase === 'spinning' && (
                                <div className="rl-spinning-text">Wheel is spinning...</div>
                            )}
                            {game.phase === 'results' && game.result !== null && showResult && (
                                <div className={\`rl-result-badge rl-result-\${getColor(game.result)}\`}>
                                    <span className="rl-result-num">{game.result}</span>
                                    <span className="rl-result-label">
                                        {resultColor === 'green' ? '🟢 Zero' : resultColor === 'red' ? '🔴 Red' : '⚫ Black'}
                                        {game.result > 0 ? (game.result % 2 === 0 ? ' · Even' : ' · Odd') : ''}
                                    </span>
                                </div>
                            )}
                            {game.phase === 'results' && myPayout !== undefined && showResult && (
                                <div className={\`rl-payout-result \${myPayout >= 0 ? 'win' : 'lose'}\`}>
                                    {myPayout > 0 ? \`+\${myPayout}\` : myPayout} chips
                                </div>
                            )}
                        </div>
                        
                        <div style={{ marginTop: '1rem', width: '100%' }}>
                            <HistoryStrip history={game.spinHistory} />
                        </div>
                        
                        {/* Payout breakdown */}
                        {game.phase === 'results' && game.payouts && showResult && (
                            <div className="rl-results" style={{ marginTop: '1rem', width: '100%' }}>
                                <div className="rl-payouts-list">
                                    {Object.entries(game.payouts).map(([pid, net]) => {
                                        const player = game.bets.find(b => b.peer_id === pid);
                                        return (
                                            <div key={pid} className={\`rl-payout-row \${net >= 0 ? 'win' : 'lose'}\`}>
                                                <span>{player?.nick || pid.slice(0, 8)}</span>
                                                <span>{net >= 0 ? \`+\${net}\` : net} chips</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Chip selector + number grid + outside bets */}
                    <div className="rl-right-col">
                        {/* Chip selector */}
                        <div className="chip-selector" style={{ marginBottom: '0.75rem' }}>
                            {BET_AMOUNTS.map(a => (
                                <button
                                    key={a}
                                    className={\`chip-btn \${betAmount === a ? 'active' : ''}\`}
                                    onClick={() => setBetAmount(a)}
                                    disabled={a > balance}
                                >
                                    {a}
                                </button>
                            ))}
                        </div>

                        {/* Number grid — vertical layout: 12 rows × 3 cols */}
                        <div className="rl-grid-wrap">
                            <button
                                className={\`rl-zero \${myBets.some(b => b.betType === 'single' && b.betTarget === 0) ? 'selected' : ''}\`}
                                onClick={() => handleBet('single', 0)} disabled={!canBet}
                            >0</button>
                            <div className="rl-grid-vertical">
                                {rows.map((row, ri) => (
                                    <div key={ri} className="rl-grid-row">
                                        {row.map(n => (
                                            <NumberCell
                                                key={n} n={n}
                                                selected={myBets.some(b => b.betType === 'single' && b.betTarget === n)}
                                                onBet={handleBet}
                                                disabled={!canBet}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                            {/* Column 2:1 bets — one below each row group */}
                            <div className="rl-col-bets-vertical">
                                {[1, 2, 3].map(c => (
                                    <OutsideBtn key={c} label="2:1" type="column" target={c} myBets={myBets} onBet={handleBet} disabled={!canBet} className="sm" />
                                ))}
                            </div>
                        </div>

                        {/* Outside bets */}
                        <div className="rl-outside-bets">
                            <div className="rl-outside-row">
                                <OutsideBtn label={"1–18\\n1:1"} type="half" target="low" myBets={myBets} onBet={handleBet} disabled={!canBet} />
                                <OutsideBtn label={"EVEN\\n1:1"} type="parity" target="even" myBets={myBets} onBet={handleBet} disabled={!canBet} />
                                <OutsideBtn label={"🔴 Red\\n1:1"} type="color" target="red" myBets={myBets} onBet={handleBet} disabled={!canBet} className="red" />
                                <OutsideBtn label={"⚫ Black\\n1:1"} type="color" target="black" myBets={myBets} onBet={handleBet} disabled={!canBet} className="black" />
                                <OutsideBtn label={"ODD\\n1:1"} type="parity" target="odd" myBets={myBets} onBet={handleBet} disabled={!canBet} />
                                <OutsideBtn label={"19–36\\n1:1"} type="half" target="high" myBets={myBets} onBet={handleBet} disabled={!canBet} />
                            </div>
                            <div className="rl-outside-row">
                                <OutsideBtn label={"1st 12\\n2:1"} type="dozen" target={1} myBets={myBets} onBet={handleBet} disabled={!canBet} className="sm" />
                                <OutsideBtn label={"2nd 12\\n2:1"} type="dozen" target={2} myBets={myBets} onBet={handleBet} disabled={!canBet} className="sm" />
                                <OutsideBtn label={"3rd 12\\n2:1"} type="dozen" target={3} myBets={myBets} onBet={handleBet} disabled={!canBet} className="sm" />
                            </div>
                        </div>

                        {/* My bets summary */}
                        {myBets.length > 0 && (
                            <div className="rl-my-bets">
                                <span>{myBets.length} bet{myBets.length > 1 ? 's' : ''} · {totalMyBet} chips</span>
                                {canBet && <button className="rl-clear-btn" onClick={() => onAction({ type: 'clearBets' })}>Clear</button>}
                            </div>
                        )}

                        {/* Live bets ticker */}
                        {game.bets?.length > 0 && (
                            <div className="rl-all-bets">
                                <div className="section-mini-title">Live bets</div>
                                <div className="rl-bets-list">
                                    {game.bets.map((b, i) => (
                                        <span key={i} className="rl-bet-tag">
                                            {b.nick}: {b.betType === 'single' ? \`#\${b.betTarget}\` : b.betTarget} — {b.amount}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
`;

fs.writeFileSync('src/components/RouletteBoard.jsx', beforeReturn + newReturn);
console.log('Successfully replaced layout');
