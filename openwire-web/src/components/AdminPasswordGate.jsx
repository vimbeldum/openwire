import { useState } from 'react';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Input from './ui/Input';
import Panel from './ui/Panel';

// --- Admin Password Gate ---
export function AdminPasswordGate({ onSuccess, onCancel }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        // Simulate slight delay for UX
        await new Promise(r => setTimeout(r, 400));

        // Use environment variable, fallback to openwire-admin for local dev if not set
        const correctPassword = import.meta.env.VITE_ADMIN_PASSWORD || 'openwire-admin';

        if (password === correctPassword) {
            onSuccess();
        } else {
            setError('Incorrect password.');
        }
        setLoading(false);
    };

    return (
        <div className="admin-overlay" role="dialog" aria-modal="true" aria-label="Admin password required" onClick={(e) => e.target === e.currentTarget && onCancel()}>
            <Panel tone="subtle" padding="lg">
                <div className="admin-gate-icon">🔐</div>
                <div className="admin-gate-header">
                    <h2>Admin Access</h2>
                    <Badge tone="neutral">Restricted</Badge>
                </div>
                <form onSubmit={handleSubmit}>
                    <Input
                        id="admin-password"
                        type="password"
                        placeholder="Admin password"
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            setError('');
                        }}
                        autoFocus
                        label="Password"
                        invalid={Boolean(error)}
                        error={error}
                    />
                    <div className="admin-gate-actions">
                        <Button type="submit" variant="primary" disabled={loading}>
                            {loading ? 'Checking…' : 'Unlock'}
                        </Button>
                        <Button type="button" variant="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                    </div>
                </form>
            </Panel>
        </div>
    );
}
