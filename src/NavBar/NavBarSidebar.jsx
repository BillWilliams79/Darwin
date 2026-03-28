import React, { useContext, useState, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthContext from '../Context/AuthContext';
import {
    NAV_GROUPS, NAV_LINKS, PROFILE_LINK, BIKE_MENU_LINKS,
    SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH, GROUP_PROFILE_KEY,
} from './navConfig';

import AppBar from '@mui/material/AppBar';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

const ACCENT = '#E91E63';
const BG_ACTIVE = 'rgba(233, 30, 99, 0.12)';

const isDev = import.meta.env.MODE === 'development';
const DEV_BORDER = isDev ? '4px solid #FF6B35' : 'none';

const NavBarSidebar = () => {
    const { idToken, profile } = useContext(AuthContext);
    const location = useLocation();
    const navigate = useNavigate();
    const isDesktop = useMediaQuery('(min-width:900px)');

    const [collapsed, setCollapsed] = useState(false);
    const [bikeAnchor, setBikeAnchor] = useState(null);

    // Filter nav groups/links based on profile app toggle settings
    const visibleGroups = useMemo(() =>
        NAV_GROUPS.filter(g => {
            const key = GROUP_PROFILE_KEY[g.id];
            return !key || Number(profile?.[key] ?? 1) === 1;
        }),
        [profile]
    );
    const visibleLinks = useMemo(() =>
        NAV_LINKS.filter(l => {
            const key = GROUP_PROFILE_KEY[l.group];
            return !key || Number(profile?.[key] ?? 1) === 1;
        }),
        [profile]
    );

    const isActive = (path) => {
        if (path === '/swarm') return location.pathname === '/swarm';
        return location.pathname.startsWith(path);
    };

    const bikeMenuOpen = Boolean(bikeAnchor);

    const handleBikeClick = (e) => {
        if (idToken) setBikeAnchor(e.currentTarget);
    };

    const handleBikeClose = () => setBikeAnchor(null);

    const handleBikeNav = (path) => {
        handleBikeClose();
        navigate(path);
    };

    // Shared bicycle menu (used by both desktop and mobile)
    const bikeMenu = (
        <Menu
            anchorEl={bikeAnchor}
            open={bikeMenuOpen}
            onClose={handleBikeClose}
            slotProps={{
                paper: {
                    sx: {
                        bgcolor: '#1a1a1a',
                        color: 'white',
                        minWidth: 160,
                    },
                },
            }}
        >
            {BIKE_MENU_LINKS.map((link) => {
                const Icon = link.icon;
                const active = isActive(link.path);
                return (
                    <MenuItem
                        key={link.path}
                        onClick={() => handleBikeNav(link.path)}
                        sx={{
                            bgcolor: active ? BG_ACTIVE : 'transparent',
                            '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
                            gap: 1.5,
                            py: 1,
                        }}
                    >
                        <Icon sx={{ fontSize: 18, color: active ? ACCENT : 'rgba(255,255,255,0.7)' }} />
                        <Typography sx={{
                            fontSize: 15,
                            color: active ? 'white' : 'rgba(255,255,255,0.7)',
                            fontWeight: active ? 600 : 400,
                        }}>
                            {link.label}
                        </Typography>
                    </MenuItem>
                );
            })}
        </Menu>
    );

    const renderNavItem = (link, showText) => {
        const Icon = link.icon;
        const active = isActive(link.path);
        const button = (
            <ListItemButton
                key={link.path}
                component={Link}
                to={link.path}
                sx={{
                    bgcolor: active ? BG_ACTIVE : 'transparent',
                    borderRight: active ? `3px solid ${ACCENT}` : '3px solid transparent',
                    py: 0.6,
                    px: showText ? 1.5 : 1,
                    minHeight: 36,
                    justifyContent: showText ? 'initial' : 'center',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
                }}
            >
                <ListItemIcon sx={{
                    color: active ? ACCENT : 'rgba(255,255,255,0.7)',
                    minWidth: showText ? 32 : 'auto',
                    justifyContent: 'center',
                }}>
                    <Icon sx={{ fontSize: 18 }} />
                </ListItemIcon>
                {showText && (
                    <ListItemText
                        primary={link.label}
                        primaryTypographyProps={{
                            fontSize: 15,
                            color: active ? 'white' : 'rgba(255,255,255,0.7)',
                            fontWeight: active ? 600 : 400,
                        }}
                    />
                )}
            </ListItemButton>
        );
        return showText ? button : (
            <Tooltip key={link.path} title={link.label} placement="right">
                {button}
            </Tooltip>
        );
    };

    // ── Desktop: sidebar with edge collapse arrow ──
    if (isDesktop) {
        const showText = !collapsed;
        const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

        return (
            <>
                {isDev && <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, height: '4px', bgcolor: '#FF6B35', zIndex: 1300 }} />}
                <Box
                    className="app-navbar"
                    sx={{ width, flexShrink: 0, transition: 'width 0.2s ease', height: '100vh', position: 'sticky', top: 0 }}
                >
                    <Box sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100vh',
                        bgcolor: 'black',
                        color: 'white',
                        overflow: 'hidden',
                        width,
                        transition: 'width 0.2s ease',
                    }}>
                            {/* Bicycle menu trigger + Darwin title */}
                            <Box sx={{ px: 1.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <IconButton
                                    onClick={handleBikeClick}
                                    size="small"
                                    data-testid="bike-menu-button"
                                    sx={{
                                        p: 0.25,
                                        color: ACCENT,
                                        '&:hover': { bgcolor: 'rgba(233,30,99,0.12)' },
                                    }}
                                >
                                    <PROFILE_LINK.icon sx={{ fontSize: 20 }} />
                                </IconButton>
                                {showText && (
                                    <Link to="/" style={{ textDecoration: 'none' }}>
                                        <Typography sx={{ color: 'white', fontSize: 19, fontFamily: 'Roboto', fontWeight: 500 }}>
                                            Darwin
                                        </Typography>
                                    </Link>
                                )}
                            </Box>

                            {/* Primary nav links */}
                            <List sx={{ flex: 1, pt: 0, pb: 0 }}>
                                {visibleGroups.map((group) => {
                                    const groupLinks = visibleLinks.filter(l => l.group === group.id);
                                    return (
                                        <React.Fragment key={group.id}>
                                            {showText && (
                                                <ListSubheader sx={{
                                                    bgcolor: 'transparent',
                                                    color: 'rgba(255,255,255,0.5)',
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                    letterSpacing: 1.5,
                                                    lineHeight: '28px',
                                                    pl: 1.5,
                                                    mt: 0.5,
                                                }}>
                                                    {group.label}
                                                </ListSubheader>
                                            )}
                                            {groupLinks.map((link) => renderNavItem(link, showText))}
                                        </React.Fragment>
                                    );
                                })}
                            </List>
                    </Box>

                    {/* Google Maps-style edge collapse tab */}
                    <Box
                        onClick={() => setCollapsed(c => !c)}
                        sx={{
                            position: 'fixed',
                            left: width,
                            top: '50vh',
                            transform: 'translateY(-50%)',
                            zIndex: 1201,
                            width: 12,
                            height: 32,
                            borderRadius: '0 6px 6px 0',
                            bgcolor: '#555',
                            color: 'rgba(255,255,255,0.7)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: '#777', color: 'white', width: 16 },
                            transition: 'left 0.2s ease, width 0.15s ease, background-color 0.15s ease',
                        }}
                    >
                        {collapsed
                            ? <ChevronRightIcon sx={{ fontSize: 14 }} />
                            : <ChevronLeftIcon sx={{ fontSize: 14 }} />
                        }
                    </Box>
                </Box>
                {bikeMenu}
            </>
        );
    }

    // ── Mobile: top bar with bicycle + bottom nav ──
    const bottomNavValue = visibleLinks.findIndex(l => isActive(l.path));

    return (
        <>
            {/* Slim top bar */}
            <AppBar
                position="static"
                className="app-navbar"
                sx={{ bgcolor: 'black', borderTop: DEV_BORDER }}
            >
                <Toolbar variant="dense" sx={{ minHeight: 48 }}>
                    <IconButton
                        edge="start"
                        onClick={handleBikeClick}
                        data-testid="bike-menu-button"
                        sx={{ color: ACCENT }}
                    >
                        <PROFILE_LINK.icon />
                    </IconButton>
                    <Link to="/" style={{ textDecoration: 'none', marginLeft: 8 }}>
                        <Typography sx={{ color: 'white', fontSize: 18, fontFamily: 'Roboto', fontWeight: 500 }}>
                            Darwin
                        </Typography>
                    </Link>
                </Toolbar>
            </AppBar>

            {/* Bicycle popover menu */}
            {bikeMenu}

            {/* Bottom navigation — all 5 primary links */}
            <Paper
                sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200 }}
                elevation={3}
            >
                <BottomNavigation
                    value={bottomNavValue >= 0 ? bottomNavValue : false}
                    onChange={(_, newValue) => {
                        navigate(visibleLinks[newValue].path);
                    }}
                    sx={{
                        bgcolor: '#111',
                        '& .MuiBottomNavigationAction-root': {
                            color: 'rgba(255,255,255,0.5)',
                            minWidth: 'auto',
                            px: 0.5,
                        },
                        '& .Mui-selected': {
                            color: ACCENT,
                        },
                    }}
                >
                    {visibleLinks.map((link) => {
                        const Icon = link.icon;
                        return (
                            <BottomNavigationAction
                                key={link.path}
                                label={link.label}
                                icon={<Icon />}
                            />
                        );
                    })}
                </BottomNavigation>
            </Paper>
        </>
    );
};

export default NavBarSidebar;
