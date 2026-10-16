import { CoinWallet } from '../coins/CoinWallet.js';

export function CoinWalletPage() {
  return (
    <div className="profile-page">
      <a className="social-back" href="/profile">
        ← 返回我的资料
      </a>
      <header className="page-heading">
        <h1>我的桌游币</h1>
      </header>
      <CoinWallet />
    </div>
  );
}
