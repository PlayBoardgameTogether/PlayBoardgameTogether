import { useState } from 'react';

type ArtworkProps = {
  src: string | null;
  className: string;
  name: string;
  eager?: boolean;
};

export function GameArtwork(props: ArtworkProps) {
  return <ArtworkImage key={props.src} {...props} />;
}

function ArtworkImage({ src, className, name, eager }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={className}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="game-art-fallback" aria-label="展示图片不可用">
          {name.slice(0, 1)}
        </span>
      )}
    </div>
  );
}
