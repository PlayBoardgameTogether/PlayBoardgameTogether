import { lazy, type ReactNode } from 'react';
import { guides } from './developer-guides.js';

const RootPage = lazy(() => import('./RootPage.js'));
const CoinWalletPage = lazy(() => import('../pages/CoinWalletPage.js').then(module => ({ default: module.CoinWalletPage })));
const AdminCoinsPage = lazy(() => import('../pages/admin/AdminCoinsPage.js').then(module => ({ default: module.AdminCoinsPage })));
const BadgesPage = lazy(() => import('../pages/BadgesPage.js').then(module => ({ default: module.BadgesPage })));
const AdminBadgesPage = lazy(() => import('../pages/admin/AdminBadgesPage.js').then(module => ({ default: module.AdminBadgesPage })));
const LoginPage = lazy(() => import('../pages/LoginPage.js').then(module => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import('../pages/RegisterPage.js').then(module => ({ default: module.RegisterPage })));
const ProfilePage = lazy(() => import('../pages/ProfilePage.js').then(module => ({ default: module.ProfilePage })));
const FriendsPage = lazy(() => import('../pages/FriendsPage.js').then(module => ({ default: module.FriendsPage })));
const PublicChatPage = lazy(() => import('../pages/PublicChatPage.js').then(module => ({ default: module.PublicChatPage })));
const NewRoomPage = lazy(() => import('../pages/NewRoomPage.js').then(module => ({ default: module.NewRoomPage })));
const GameDetailPage = lazy(() => import('../pages/GameDetailPage.js').then(module => ({ default: module.GameDetailPage })));
const TutorialPage = lazy(() => import('../pages/TutorialPage.js').then(module => ({ default: module.TutorialPage })));
const RoomPage = lazy(() => import('../pages/RoomPage.js').then(module => ({ default: module.RoomPage })));
const ReplayPage = lazy(() => import('../pages/ReplayPage.js').then(module => ({ default: module.ReplayPage })));
const MatchPage = lazy(() => import('../pages/MatchPage.js').then(module => ({ default: module.MatchPage })));
const AssetAdminPage = lazy(() => import('../pages/AssetAdminPage.js').then(module => ({ default: module.AssetAdminPage })));
const GamePresentationAdminPage = lazy(() => import('../pages/GamePresentationAdminPage.js').then(module => ({ default: module.GamePresentationAdminPage })));
const AdminOverviewPage = lazy(() => import('../pages/admin/AdminOverviewPage.js').then(module => ({ default: module.AdminOverviewPage })));
const AdminUpdatesPage = lazy(() => import('../pages/admin/AdminUpdatesPage.js').then(module => ({ default: module.AdminUpdatesPage })));
const AdminAccountsPage = lazy(() => import('../pages/admin/AdminAccountsPage.js').then(module => ({ default: module.AdminAccountsPage })));
const AdminGamesPage = lazy(() => import('../pages/admin/AdminGamesPage.js').then(module => ({ default: module.AdminGamesPage })));
const AdminSubmissionsPage = lazy(() => import('../pages/admin/AdminSubmissionsPage.js').then(module => ({ default: module.AdminSubmissionsPage })));
const ModelSettingsPage = lazy(() => import('../pages/ModelSettingsPage.js').then(module => ({ default: module.ModelSettingsPage })));
const StatusPage = lazy(() => import('../pages/StatusPage.js').then(module => ({ default: module.StatusPage })));
const DevelopersPage = lazy(() => import('../pages/DevelopersPage.js').then(module => ({ default: module.DevelopersPage })));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage.js').then(module => ({ default: module.NotFoundPage })));
const labEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_LAB === 'true';
const LabPage = labEnabled ? lazy(() => import('../pages/LabPage.js').then(module => ({ default: module.LabPage }))) : undefined;
const UiScenes = labEnabled ? lazy(() => import('../dev/UiScenes.js')) : undefined;

export interface PageRoute {
  title: string;
  documentTitle?: string;
  page: ReactNode;
  game?: boolean;
  developer?: boolean;
}

// One owner for route matching, workspace titles and document titles.
export function resolvePage(path: string): PageRoute {
  const accountCoins = /^\/admin\/accounts\/([0-9a-f-]{36})\/coins$/i.exec(path);
  if (accountCoins) return { title: '桌游币管理', page: <AdminCoinsPage accountId={accountCoins[1]!} /> };
  const accountBadges = /^\/admin\/accounts\/([0-9a-f-]{36})\/badges$/i.exec(path);
  if (accountBadges) return { title: '徽章管理', page: <AdminBadgesPage accountId={accountBadges[1]!} /> };
  const game = /^\/games\/([a-z0-9._-]+)\/([a-z0-9._-]+)(\/(?:new|tutorial))?$/i.exec(path);
  if (game) {
    const selectedGame = { id: game[1]!, version: game[2]! };
    if (game[3] === '/tutorial') return {
      title: '上手教程', game: true,
      page: <TutorialPage key={`${selectedGame.id}@${selectedGame.version}`} {...selectedGame} />,
    };
    return game[3] === '/new'
      ? { title: '创建房间', page: <NewRoomPage selectedGame={selectedGame} /> }
      : { title: '游戏详情', page: <GameDetailPage {...selectedGame} /> };
  }
  const developer = /^\/developers(?:\/([a-z-]+))?$/.exec(path);
  if (developer) {
    const slug = developer[1] ?? 'index';
    const guide = guides.find(item => item.slug === slug);
    return {
      title: '开发者文档', developer: true,
      documentTitle: `${guide?.title ?? '未找到开发文档'} · 桌游平台开发文档`,
      page: <DevelopersPage slug={slug} />,
    };
  }
  const room = /^\/rooms\/([0-9a-f-]+)$/i.exec(path);
  if (room) return { title: '房间', page: <RoomPage key={room[1]} id={room[1]!} /> };
  const replay = /^\/matches\/([0-9a-f-]+)\/replay$/i.exec(path);
  if (replay) return { title: '对局回放', game: true, page: <ReplayPage key={replay[1]} id={replay[1]!} /> };
  const match = /^\/matches\/([0-9a-f-]+)$/i.exec(path);
  if (match) return { title: '游戏桌', game: true, page: <MatchPage key={match[1]} id={match[1]!} /> };
  const chat = /^\/friends\/chat\/([0-9a-f-]{36})$/i.exec(path);
  if (chat) return { title: '好友私聊', page: <FriendsPage section="chat" friendId={chat[1]!} /> };
  switch (path) {
    case '/': return { title: '游戏大厅', page: <RootPage /> };
    case '/login': return { title: '账户登录', page: <LoginPage /> };
    case '/register': return { title: '账号注册', page: <RegisterPage /> };
    case '/profile/coins': return { title: '我的桌游币', page: <CoinWalletPage /> };
    case '/profile': return { title: '我的资料', page: <ProfilePage /> };
    case '/profile/badges': return { title: '我的徽章', page: <BadgesPage /> };
    case '/profile/edit': return { title: '编辑资料', page: <ProfilePage section="edit" /> };
    case '/profile/history': return { title: '对局记录', page: <ProfilePage section="history" /> };
    case '/profile/identity': return { title: '管理好友 ID', page: <ProfilePage section="identity" /> };
    case '/friends/add': return { title: '添加好友', page: <FriendsPage section="add" /> };
    case '/friends/requests': return { title: '好友申请', page: <FriendsPage section="requests" /> };
    case '/friends/invitations': return { title: '房间邀请', page: <FriendsPage section="invitations" /> };
    case '/friends': return { title: '好友', page: <FriendsPage /> };
    case '/chat': return { title: '公共聊天', page: <PublicChatPage /> };
    case '/rooms/new': return { title: '创建房间', page: <NewRoomPage /> };
    case '/settings/models': return { title: '模型设置', page: <ModelSettingsPage /> };
    case '/admin': return { title: '管理员后台', page: <AdminOverviewPage /> };
    case '/admin/updates': return { title: '服务更新', page: <AdminUpdatesPage /> };
    case '/admin/accounts': return { title: '账户管理', page: <AdminAccountsPage /> };
    case '/admin/catalog': return { title: '游戏管理', page: <AdminGamesPage /> };
    case '/admin/submissions': return { title: '接入审核', page: <AdminSubmissionsPage /> };
    case '/admin/assets': return { title: '资源管理', page: <AssetAdminPage /> };
    case '/admin/games': return { title: '游戏展示', page: <GamePresentationAdminPage /> };
    case '/status': return { title: '系统状态', page: <StatusPage /> };
    case '/dev/lab': if (LabPage) return { title: '扩展实验台', page: <LabPage /> }; break;
    case '/dev/ui': if (UiScenes) return { title: '界面场景', page: <UiScenes /> }; break;
  }
  return { title: '页面不存在', page: <NotFoundPage /> };
}
