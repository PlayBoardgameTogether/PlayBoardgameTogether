import { useEffect, useState } from 'react';
import type { Badge } from '@boardgame/protocol';
import { loadBadgeMedia, type BadgeMedia } from './media.js';
import { BadgePreview } from './BadgePreview.js';

export function BadgeArtwork({ badge, compact = false }: { badge: Badge; compact?: boolean }) {
  const [media, setMedia] = useState<BadgeMedia>();
  const [imageFailed, setImageFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setMedia(undefined);
    setImageFailed(false);
    setOpen(false);
    void loadBadgeMedia().then((items) => {
      if (active) setMedia(items[badge.id]);
    });
    return () => {
      active = false;
    };
  }, [badge.id]);

  const artwork =
    media?.poster && !imageFailed ? (
      <img src={media.poster} alt="" loading="lazy" onError={() => setImageFailed(true)} />
    ) : (
      <span aria-hidden="true">{badge.symbol}</span>
    );

  return (
    <>
      {compact ? (
        media?.model ? (
          <button
            className="badge-pin-preview"
            aria-label={`查看${badge.name}的 3D 模型`}
            onClick={() => setOpen(true)}
          >
            {artwork} {badge.name}
          </button>
        ) : (
          <>
            {artwork} {badge.name}
          </>
        )
      ) : (
        <>
          <div
            className={`badge-medal${media?.poster && !imageFailed ? ' has-artwork' : ''}`}
            aria-hidden="true"
          >
            {artwork}
          </div>
          {media?.model && (
            <button
              className="secondary badge-preview-trigger"
              aria-label={`查看${badge.name}的 3D 模型`}
              onClick={() => setOpen(true)}
            >
              查看 3D
            </button>
          )}
        </>
      )}
      {open && media?.model && (
        <BadgePreview badge={badge} model={media.model} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
