import { CoinWallet } from '../../coins/CoinWallet.js';
import { AdminLayout } from './AdminLayout.js';

export function AdminCoinsPage({ accountId }: { accountId: string }) {
  return (
    <AdminLayout
      path="/admin/accounts"
      title="桌游币管理"
      description="查看玩家钱包，按原因发放或扣回桌游币。"
    >
      <a href="/admin/accounts">← 返回账户管理</a>
      <CoinWallet key={accountId} accountId={accountId} />
    </AdminLayout>
  );
}
