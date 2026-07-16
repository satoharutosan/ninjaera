# Messages

DM and channel chat: thread loading, composer (text/emoji/GIF/voice/files), reactions, moderation delete, and call buttons.

## Entry points

- `MessagesPage.tsx` — layout, conversation sidebar, state orchestration
- `useMessageThread.ts` — pagination, cache, realtime sync
- `conversationState.ts` — local read/unread persistence

## Important files

| Path | Role |
|------|------|
| `components/MessageRow.tsx` | Per-message UI (actions, edit, reactions) |
| `components/MediaBubble.tsx` | Text / image / video / audio / gif / file rendering |
| `components/ImageLightbox.tsx` | Full-screen image viewer |
| `EmojiGifPicker.tsx` | Lazy-loaded emoji + GIF picker |
| `VoiceRecorder.tsx` / `VoiceMessagePlayer.tsx` | Voice capture + playback |
| `messageCache.ts` | In-memory thread cache |

## Extending

- Keep business logic out of JSX: prefer hooks (`hooks/`), utils, and `types.ts`.
- Do not micro-split trivial wrappers; extract only when a concern is clearly separate.
- Call UI lives in `features/calling` — import via `useCallOptional`, do not duplicate WebRTC here.
