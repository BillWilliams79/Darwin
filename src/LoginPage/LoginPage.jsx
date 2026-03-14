import React, { useState, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import PedalBikeIcon from '@mui/icons-material/PedalBike';

import { signIn } from '../services/cognitoAuth';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { AUTH_CONFIG } from '../config/auth';

// ─── Brand tokens (matches AuthPreview Minimal concept) ───────────────────────
const ACCENT      = '#E91E63';
const ACCENT_DARK = '#B0003A';
const BG          = '#0A0A0A';
const CARD_BG     = '#141414';
const CARD_BORDER = '#242424';
const TEXT_DIM    = 'rgba(255,255,255,0.45)';
const TEXT_FAINT  = 'rgba(255,255,255,0.25)';

const fieldSx = {
    '& .MuiOutlinedInput-root': {
        color: '#fff',
        '& fieldset': { borderColor: '#333' },
        '&:hover fieldset': { borderColor: '#555' },
        '&.Mui-focused fieldset': { borderColor: ACCENT },
    },
    '& .MuiInputLabel-root': { color: TEXT_DIM },
    '& .MuiInputLabel-root.Mui-focused': { color: ACCENT },
    '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus': {
        WebkitBoxShadow: `0 0 0 100px ${CARD_BG} inset`,
        WebkitTextFillColor: '#fff',
        caretColor: '#fff',
    },
};

const primaryBtnSx = {
    bgcolor: ACCENT,
    color: '#fff',
    fontWeight: 600,
    py: 1.4,
    fontSize: '0.9rem',
    letterSpacing: '0.04em',
    textTransform: 'none',
    borderRadius: '6px',
    '&:hover': { bgcolor: ACCENT_DARK },
    '&:disabled': { bgcolor: '#555', color: '#888' },
};

const forgotPasswordUrl = `https://${AUTH_CONFIG.domain}/forgotPassword?client_id=${AUTH_CONFIG.clientId}&redirect_uri=${encodeURIComponent(AUTH_CONFIG.redirectSignIn)}`;

function LoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { loginWithTokens } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const redirectPath = location?.state?.from?.pathname || '/taskcards';
    const accountCreated = !!location?.state?.accountCreated;

    const handleSignIn = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const tokens = await signIn(email, password);
            const profile = await loginWithTokens(tokens, darwinUri);
            navigate(profile?.timezone == null ? '/setup' : redirectPath, { replace: true });
        } catch (err) {
            if (err.code === 'UserNotConfirmedException') {
                setError('Your account is not verified. Check your email for the verification code, then use the sign-up page to confirm.');
            } else if (err.code === 'NotAuthorizedException') {
                setError('Incorrect email or password.');
            } else if (err.code === 'UserNotFoundException') {
                setError('No account found with that email.');
            } else {
                setError(err.message || 'Sign in failed. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{
            minHeight: 'calc(100vh - 56px)',
            bgcolor: BG,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 2,
        }}>
            <Paper elevation={0} sx={{
                width: '100%',
                maxWidth: 370,
                bgcolor: CARD_BG,
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: '10px',
                p: { xs: 3, sm: '32px 36px' },
            }}>
                {/* Logo */}
                <Stack alignItems="center" spacing={0.5} sx={{ mb: 3 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                        <PedalBikeIcon sx={{ fontSize: 32, color: ACCENT }} />
                        <Typography sx={{ fontSize: 24, fontWeight: 500, color: '#fff', letterSpacing: '-0.01em' }}>
                            Darwin
                        </Typography>
                    </Stack>
                    <Typography sx={{ fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: TEXT_FAINT }}>
                        Task Management
                    </Typography>
                </Stack>

                {/* Form */}
                <Box component="form" onSubmit={handleSignIn}>
                    <Stack spacing={2}>
                        {accountCreated && <Alert severity="success" sx={{ bgcolor: '#0a1a0a', color: '#8f8' }}>Account created — please sign in</Alert>}
                        {error && <Alert severity="error" sx={{ bgcolor: '#1a0a0a', color: '#f88' }}>{error}</Alert>}

                        <TextField
                            label="Email"
                            type="email"
                            variant="outlined"
                            fullWidth
                            size="small"
                            sx={fieldSx}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoComplete="email"
                            required
                            data-testid="login-email"
                        />
                        <TextField
                            label="Password"
                            type="password"
                            variant="outlined"
                            fullWidth
                            size="small"
                            sx={fieldSx}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            required
                            data-testid="login-password"
                        />

                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Typography
                                variant="caption"
                                component="a"
                                href={forgotPasswordUrl}
                                sx={{ color: ACCENT, fontSize: '0.78rem', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                            >
                                Forgot password?
                            </Typography>
                        </Box>

                        <Button
                            type="submit"
                            variant="contained"
                            fullWidth
                            sx={primaryBtnSx}
                            disabled={loading}
                            data-testid="login-submit"
                        >
                            {loading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'Sign In'}
                        </Button>

                        <Typography variant="body2" align="center" sx={{ color: TEXT_DIM }}>
                            No account?{' '}
                            <Box
                                component="span"
                                onClick={() => navigate('/signup')}
                                sx={{ color: ACCENT, cursor: 'pointer', fontWeight: 500, '&:hover': { textDecoration: 'underline' } }}
                            >
                                Create one free
                            </Box>
                        </Typography>
                    </Stack>
                </Box>
            </Paper>
        </Box>
    );
}

export default LoginPage;
