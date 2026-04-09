import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PedalBikeIcon from '@mui/icons-material/PedalBike';
import MailOutlineIcon from '@mui/icons-material/MailOutline';

import { signUp, confirmSignUp, resendVerification } from '../services/cognitoAuth';

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

function MinimalCard({ children }) {
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
                {children}
            </Paper>
        </Box>
    );
}

function MinimalLogo() {
    return (
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
    );
}

function SignupPage() {
    const navigate = useNavigate();

    // Stage: 'form' | 'verify'
    const [stage, setStage] = useState('form');

    // Form stage state
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [formLoading, setFormLoading] = useState(false);
    const [formError, setFormError] = useState('');

    // Verify stage state
    const [code, setCode] = useState('');
    const [verifyLoading, setVerifyLoading] = useState(false);
    const [verifyError, setVerifyError] = useState('');
    const [resendMsg, setResendMsg] = useState('');

    // ── Stage 1: Create account ────────────────────────────────────────────────
    const handleCreateAccount = async (e) => {
        e.preventDefault();
        setFormError('');

        if (password !== confirmPassword) {
            setFormError('Passwords do not match.');
            return;
        }
        if (password.length < 8) {
            setFormError('Password must be at least 8 characters.');
            return;
        }

        setFormLoading(true);
        try {
            await signUp(email, password);
            setStage('verify');
        } catch (err) {
            if (err.code === 'UsernameExistsException') {
                setFormError('An account with this email already exists. Try signing in.');
            } else if (err.code === 'InvalidPasswordException') {
                setFormError('Password does not meet requirements: min 8 chars, upper, lower, number, symbol.');
            } else {
                setFormError(err.message || 'Sign up failed. Please try again.');
            }
        } finally {
            setFormLoading(false);
        }
    };

    // ── Stage 2: Verify email ──────────────────────────────────────────────────
    const handleVerify = async (e) => {
        e.preventDefault();
        setVerifyError('');
        setVerifyLoading(true);
        try {
            await confirmSignUp(email, code.trim());
            // PostConfirmation Lambda fires here — provisions profile/domain/area/task in DB
            navigate('/login', { state: { accountCreated: true } });
        } catch (err) {
            if (err.code === 'CodeMismatchException') {
                setVerifyError('Incorrect code. Please check your email and try again.');
            } else if (err.code === 'ExpiredCodeException') {
                setVerifyError('Code has expired. Click "Resend code" to get a new one.');
            } else {
                setVerifyError(err.message || 'Verification failed. Please try again.');
            }
        } finally {
            setVerifyLoading(false);
        }
    };

    const handleResend = async () => {
        setResendMsg('');
        setVerifyError('');
        try {
            await resendVerification(email);
            setResendMsg('A new code has been sent to your email.');
        } catch (err) {
            setVerifyError(err.message || 'Failed to resend code.');
        }
    };

    // ── Render: Stage 1 ───────────────────────────────────────────────────────
    if (stage === 'form') {
        return (
            <MinimalCard>
                <MinimalLogo />
                <Box component="form" onSubmit={handleCreateAccount}>
                    <Stack spacing={2}>
                        {formError && <Alert severity="error" sx={{ bgcolor: '#1a0a0a', color: '#f88' }}>{formError}</Alert>}

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
                            data-testid="signup-email"
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
                            autoComplete="new-password"
                            required
                            data-testid="signup-password"
                        />
                        <TextField
                            label="Confirm Password"
                            type="password"
                            variant="outlined"
                            fullWidth
                            size="small"
                            sx={fieldSx}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            autoComplete="new-password"
                            required
                            data-testid="signup-confirm-password"
                        />

                        <Button
                            type="submit"
                            variant="contained"
                            fullWidth
                            sx={primaryBtnSx}
                            disabled={formLoading}
                            data-testid="signup-submit"
                        >
                            {formLoading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'Create Account'}
                        </Button>

                        <Typography variant="body2" align="center" sx={{ color: TEXT_DIM }}>
                            Already have an account?{' '}
                            <Box
                                component="span"
                                onClick={() => navigate('/login')}
                                sx={{ color: ACCENT, cursor: 'pointer', fontWeight: 500, '&:hover': { textDecoration: 'underline' } }}
                            >
                                Sign in
                            </Box>
                        </Typography>
                    </Stack>
                </Box>
            </MinimalCard>
        );
    }

    // ── Render: Stage 2 (verify) ──────────────────────────────────────────────
    return (
        <MinimalCard>
            <Stack alignItems="center" spacing={0.5} sx={{ mb: 3 }}>
                <MailOutlineIcon sx={{ fontSize: 36, color: ACCENT, mb: 0.5 }} />
                <Typography sx={{ fontSize: 20, fontWeight: 500, color: '#fff' }}>
                    Check your email
                </Typography>
                <Typography variant="body2" sx={{ color: TEXT_DIM, textAlign: 'center' }}>
                    We sent a 6-digit code to <strong style={{ color: '#fff' }}>{email}</strong>
                </Typography>
            </Stack>

            <Box component="form" onSubmit={handleVerify}>
                <Stack spacing={2}>
                    {verifyError && <Alert severity="error" sx={{ bgcolor: '#1a0a0a', color: '#f88' }}>{verifyError}</Alert>}
                    {resendMsg && <Alert severity="success" sx={{ bgcolor: '#0a1a0a', color: '#8f8' }}>{resendMsg}</Alert>}

                    <TextField
                        label="Verification code"
                        type="text"
                        inputMode="numeric"
                        variant="outlined"
                        fullWidth
                        size="small"
                        sx={fieldSx}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        autoComplete="one-time-code"
                        required
                        data-testid="signup-verification-code"
                    />

                    <Button
                        type="submit"
                        variant="contained"
                        fullWidth
                        sx={primaryBtnSx}
                        disabled={verifyLoading}
                        data-testid="signup-verify-submit"
                    >
                        {verifyLoading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'Verify Account'}
                    </Button>

                    <Typography variant="body2" align="center" sx={{ color: TEXT_DIM }}>
                        Didn't get it?{' '}
                        <Box
                            component="span"
                            onClick={handleResend}
                            sx={{ color: ACCENT, cursor: 'pointer', fontWeight: 500, '&:hover': { textDecoration: 'underline' } }}
                        >
                            Resend code
                        </Box>
                    </Typography>
                </Stack>
            </Box>
        </MinimalCard>
    );
}

export default SignupPage;
