import { useEffect, useRef, useState } from 'react';
import { PageFeedback } from '@boardgame/ui';
import {
  applyTutorialAction, startTutorialStep, type GameTutorial, type TutorialProgress,
} from '@boardgame/game-sdk/tutorial';
import { clientGame, clientTutorial, type GameBoard } from '../game-registry.js';
import { gamePath, useGameCatalog } from './game-catalog.js';
import '../styles/tutorial.css';

export function TutorialPage({ id, version }: { id: string; version: string }) {
  const catalog = useGameCatalog();
  const back = gamePath({ id, version });
  const game = catalog.games?.find(item => item.id === id && item.version === version);
  const loader = clientTutorial(id, version);
  const client = clientGame(id, version);
  const [loaded, setLoaded] = useState<{ tutorial: GameTutorial; board: GameBoard }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setLoaded(undefined);
    setError('');
    if (game && loader && client) {
      void Promise.all([loader(), client.load()]).then(([tutorial, board]) => {
        if (!tutorial.steps.length || new Set(tutorial.steps.map(step => step.id)).size !== tutorial.steps.length) {
          throw new Error('Invalid tutorial steps');
        }
        if (!disposed) setLoaded({ tutorial, board });
      }).catch(() => { if (!disposed) setError('教程加载失败，请检查连接后重试。'); });
    }
    return () => { disposed = true; };
  }, [game, loader, client]);
  if (catalog.error) return <PageFeedback title="游戏加载失败" retry={catalog.retry}>{catalog.error}</PageFeedback>;
  if (!catalog.games) return <PageFeedback title="正在加载游戏…" loading />;
  if (!game) return <PageFeedback title="游戏暂不可用">该游戏或版本未启用。<a href="/">返回游戏大厅</a></PageFeedback>;
  if (!loader || !client) return <PageFeedback title="该游戏暂未提供交互教程"><a href={back}>返回游戏详情阅读规则</a></PageFeedback>;
  if (error) return <PageFeedback title="教程加载失败" retry={() => window.location.reload()}>{error}<p><a href={back}>返回游戏详情</a></p></PageFeedback>;
  if (!loaded) return <PageFeedback title="正在准备教程…" loading />;
  return <TutorialPlayer tutorial={loaded.tutorial} board={loaded.board} back={back} />;
}

function TutorialPlayer({ tutorial, board, back }: { tutorial: GameTutorial; board: GameBoard; back: string }) {
  const [progress, setProgress] = useState<TutorialProgress>(() => startTutorialStep(tutorial));
  const [finished, setFinished] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = tutorial.steps[progress.stepIndex]!;
  useEffect(() => {
    const targets = [...(area.current?.querySelectorAll<HTMLElement>('[aria-label]') ?? [])]
      .filter(element => element.getAttribute('aria-label') === step.focusArea);
    for (const target of targets) target.dataset.tutorialTarget = 'true';
    return () => { for (const target of targets) delete target.dataset.tutorialTarget; };
  }, [step, sceneKey, finished]);

  function reset(index: number) {
    setProgress(startTutorialStep(tutorial, index));
    setFinished(false);
    setSceneKey(value => value + 1);
    heading.current?.focus();
  }

  function onAction(action: unknown) {
    setProgress(current => {
      if (current.stepIndex !== progress.stepIndex || current.complete) return current;
      try {
        return applyTutorialAction(tutorial, current, action);
      } catch {
        return { ...current, feedback: '练习操作暂时无法处理，可以重试本步。' };
      }
    });
  }

  return <div className="tutorial-page">
    <div className="tutorial-toolbar"><a href={back}>← 返回游戏详情</a><button className="secondary" onClick={() => reset(0)}>重新开始教程</button></div>
    <div className="tutorial-intro"><p className="eyebrow">交互教程 · 单人练习</p><h1>{tutorial.title}</h1><p className="muted">{tutorial.description}</p><p className="muted">练习模式不计入战绩，可随时反复演练。</p></div>
    {finished ? <section className="panel tutorial-guide" role="status">
      <h2>教程完成</h2><p>恭喜完成练习！快去大厅开一桌大展身手吧。</p>
      <div className="tutorial-actions"><a className="button-link" href={back}>返回游戏详情</a><button className="secondary" onClick={() => reset(0)}>再练一次</button></div>
    </section> : <>
      <section className="panel tutorial-guide" aria-label="教程指引">
        <p className="eyebrow">练习 {progress.stepIndex + 1} / {tutorial.steps.length}</p>
        <progress aria-label="教程进度" max={tutorial.steps.length} value={progress.stepIndex + (progress.complete ? 1 : 0)} />
        <h2 ref={heading} tabIndex={-1}>{step.title}</h2><p>{step.instruction}</p>
        <p role="status" aria-live="polite" className="tutorial-feedback">{progress.feedback || '在下方游戏桌面完成操作'}</p>
        <div className="tutorial-actions">
          <button disabled={!progress.complete} onClick={() => {
            if (progress.stepIndex === tutorial.steps.length - 1) setFinished(true);
            else reset(progress.stepIndex + 1);
          }}>{progress.stepIndex === tutorial.steps.length - 1 ? '完成教程' : '下一步'}</button>
          <button className="secondary" onClick={() => reset(progress.stepIndex)}>重试本步</button>
          {progress.stepIndex > 0 && <button className="secondary" onClick={() => reset(progress.stepIndex - 1)}>上一步</button>}
        </div>
      </section>
      <div ref={area} key={sceneKey} className="tutorial-board" aria-label="教程练习桌面">
        {board(progress.frame.view, progress.complete, progress.frame.events, onAction)}
      </div>
    </>}
  </div>;
}
