import { BadgeWall } from '../badges/BadgeWall.js';

export function BadgesPage() {
  return (
    <div className="profile-page">
      <a className="social-back" href="/profile">
        ← 返回我的资料
      </a>
      <BadgeWall />
    </div>
  );
}
