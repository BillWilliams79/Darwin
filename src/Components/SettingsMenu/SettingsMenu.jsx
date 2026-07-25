import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import SettingsIcon from '@mui/icons-material/Settings';
import Check from '@mui/icons-material/Check';

// `toggleItems` — optional checkable preferences shown above the nav `links`,
// separated by a Divider. Each: { label, checked, onToggle, testId }. Kept
// generic (not swarm-specific) so any page using SettingsMenu can surface a
// persisted on/off preference without inventing its own separate menu.
const SettingsMenu = ({ links, toggleItems = [], tooltipTitle = 'Settings' }) => {
    const navigate = useNavigate();
    const [anchorEl, setAnchorEl] = useState(null);
    const open = Boolean(anchorEl);

    const handleClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleNav = (path) => {
        handleClose();
        navigate(path);
    };

    return (
        <>
            <Tooltip title={tooltipTitle}>
                <IconButton
                    size="small"
                    onClick={handleClick}
                    data-testid="settings-menu-button"
                    sx={{ flexShrink: 0, mx: 1 }}
                >
                    <SettingsIcon />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
            >
                {toggleItems.map((item) => (
                    <MenuItem
                        key={item.testId || item.label}
                        onClick={item.onToggle}
                        data-testid={item.testId}
                    >
                        <ListItemIcon>
                            {item.checked && <Check fontSize="small" />}
                        </ListItemIcon>
                        <ListItemText>{item.label}</ListItemText>
                    </MenuItem>
                ))}
                {toggleItems.length > 0 && links.length > 0 && <Divider />}
                {links.map((link) => {
                    const Icon = link.icon;
                    return (
                        <MenuItem key={link.path} onClick={() => handleNav(link.path)}>
                            {Icon && (
                                <ListItemIcon>
                                    <Icon fontSize="small" />
                                </ListItemIcon>
                            )}
                            <ListItemText>{link.label}</ListItemText>
                        </MenuItem>
                    );
                })}
            </Menu>
        </>
    );
};

export default SettingsMenu;
