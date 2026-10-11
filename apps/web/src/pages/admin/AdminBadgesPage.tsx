import { BadgeWall } from '../../badges/BadgeWall.js';
import { AdminLayout } from './AdminLayout.js';

export function AdminBadgesPage({ accountId }: { accountId: string }) {
  return (
    <AdminLayout
      path="/admin/accounts"
      title="徽章管理"
      description="管理玩家的身份荣誉；成长成就由真实对局记录计算。"
    >
      <a href="/admin/accounts">← 返回账户管理</a>
      <BadgeWall key={accountId} accountId={accountId} />
    </AdminLayout>
  );
}
