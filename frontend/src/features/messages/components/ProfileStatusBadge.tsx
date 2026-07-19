import { useState } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import CheckIcon from "@mui/icons-material/Check";
import { STATUS_COLORS } from "@/features/messages/constants";
import type { ColorTheme } from "@/app/shared";

const PRESENCE_OPTIONS = [
  { id: "Online", label: "Online" },
  { id: "Away", label: "Away" },
  { id: "Do Not Disturb", label: "Do Not Disturb" },
  { id: "Offline", label: "Invisible" },
] as const;

export type PresenceStatus = (typeof PRESENCE_OPTIONS)[number]["id"];

type ProfileStatusBadgeProps = {
  status: string;
  C: ColorTheme;
  disabled?: boolean;
  onChange: (status: PresenceStatus) => void | Promise<void>;
};

/**
 * Interactive presence badge for the Messages "My Profile" modal.
 * Anchors an MUI Menu to the avatar status dot (Discord/Slack style).
 */
export function ProfileStatusBadge({
  status,
  C,
  disabled,
  onChange,
}: ProfileStatusBadgeProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const open = Boolean(anchorEl);
  const color = STATUS_COLORS[status] || STATUS_COLORS.Online;

  const close = () => setAnchorEl(null);

  const select = async (next: PresenceStatus) => {
    close();
    if (next === status || busy || disabled) return;
    setBusy(true);
    try {
      await onChange(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title="Change status" placement="right" enterDelay={400}>
        <button
          type="button"
          aria-label={`Status: ${status}. Change status`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? "profile-status-menu" : undefined}
          disabled={disabled || busy}
          onClick={(e) => {
            e.stopPropagation();
            setAnchorEl(e.currentTarget);
          }}
          className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-60"
          style={{
            background: color,
            borderColor: C.surface,
            boxShadow: `0 0 0 1px ${C.outlineVar}`,
          }}
        />
      </Tooltip>
      <Menu
        id="profile-status-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            elevation: 8,
            sx: {
              mt: 0.75,
              minWidth: 200,
              borderRadius: 2,
              backgroundColor: C.surface,
              color: C.onSurface,
              border: `1px solid ${C.outlineVar}`,
              backgroundImage: "none",
            },
          },
          list: {
            "aria-label": "Presence status",
            dense: true,
            sx: { py: 0.5 },
          },
        }}
        TransitionProps={{ timeout: 160 }}
        MenuListProps={{ autoFocusItem: open }}
      >
        {PRESENCE_OPTIONS.map((opt) => {
          const selected = status === opt.id;
          const dot = STATUS_COLORS[opt.id];
          return (
            <MenuItem
              key={opt.id}
              selected={selected}
              onClick={() => { void select(opt.id); }}
              sx={{
                gap: 1,
                borderRadius: 1.5,
                mx: 0.5,
                px: 1.25,
                "&.Mui-selected": {
                  backgroundColor: `${dot}22`,
                },
                "&.Mui-selected:hover": {
                  backgroundColor: `${dot}33`,
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: dot }}
                  aria-hidden
                />
              </ListItemIcon>
              <ListItemText
                primary={opt.label}
                primaryTypographyProps={{
                  fontSize: 13,
                  fontFamily: "Roboto, sans-serif",
                  fontWeight: selected ? 600 : 500,
                  color: C.onSurface,
                }}
              />
              {selected ? (
                <CheckIcon style={{ fontSize: 16, color: dot }} aria-hidden />
              ) : null}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
