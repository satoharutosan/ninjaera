# Calling

1:1 WebRTC voice/video calls, device permissions, and call overlays.

## Entry points

- `CallProvider.tsx` — session state, invite/accept/reject, media streams
- `CallOverlays.tsx` — incoming/outgoing/in-call UI (mounted at app root)

## Important files

| Path | Role |
|------|------|
| `webrtc.ts` | Peer connection + ICE signaling |
| `devices.ts` | Camera/mic acquisition |
| `permissions.ts` | Who may place a call |
| `types.ts` | Call phases and signals |

## Extending

- Keep a single provider at the app root; pages subscribe with `useCall` / `useCallOptional`.
- Signaling continues to go through `@/app/realtime` — do not open a second socket.
