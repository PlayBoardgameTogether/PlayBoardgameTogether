import { useEffect, useRef } from 'react';
import { RoomInviteForm } from './RoomInviteForm.js';
import { PixelDiceIcon } from '../ui/PixelIcons.js';

export function RoomInviteEntry() {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!detailsRef.current?.open) return;
      if (!detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && detailsRef.current?.open) {
        detailsRef.current.open = false;
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <details ref={detailsRef} className="lobby-invite room-disclosure">
      <summary className="lobby-invite-summary">
        <PixelDiceIcon size={16} className="lobby-invite-icon" />
        <span>邀请码加入</span>
      </summary>
      <div className="lobby-invite-body">
        <div className="lobby-invite-popover-header">
          <span className="lobby-invite-popover-title">加入私人房间</span>
          <button
            type="button"
            className="lobby-invite-popover-close"
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = false;
            }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <RoomInviteForm embedded />
      </div>
    </details>
  );
}
