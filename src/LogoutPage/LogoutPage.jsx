import React, { useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import PedalBikeIcon from '@mui/icons-material/PedalBike';

import AuthContext from '../Context/AuthContext';

// ─── Brand tokens (matches AuthPreview Minimal concept) ───────────────────────
const ACCENT      = '#E91E63';
const ACCENT_DARK = '#B0003A';
const BG          = '#0A0A0A';
const CARD_BG     = '#141414';
const CARD_BORDER = '#242424';
const TEXT_DIM    = 'rgba(255,255,255,0.45)';

const primaryBtnSx = {
    bgcolor: ACCENT,
    color: '#fff',
    fontWeight: 600,
    py: 1.4,
    px: 5,
    fontSize: '0.9rem',
    letterSpacing: '0.04em',
    textTransform: 'none',
    borderRadius: '6px',
    '&:hover': { bgcolor: ACCENT_DARK },
};

function LogoutPage() {
    const navigate = useNavigate();
    const { logout } = useContext(AuthContext);

    // Clear auth state immediately on mount
    useEffect(() => {
        logout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
                <Stack spacing={2.5} alignItems="center" sx={{ py: 1 }}>
                    <PedalBikeIcon sx={{ fontSize: 56, color: ACCENT, opacity: 0.6 }} />
                    <Stack spacing={0.5} alignItems="center">
                        <Typography sx={{ fontSize: 18, fontWeight: 500, color: '#fff' }}>
                            You've been signed out
                        </Typography>
                        <Typography variant="body2" sx={{ color: TEXT_DIM, textAlign: 'center' }}>
                            Your tasks will be here when you return
                        </Typography>
                    </Stack>
                    <Button
                        variant="contained"
                        sx={primaryBtnSx}
                        onClick={() => navigate('/login')}
                        data-testid="logout-sign-back-in"
                    >
                        Sign Back In
                    </Button>
                </Stack>
            </Paper>
        </Box>
    );
}

export default LogoutPage;
