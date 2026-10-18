import {useEffect,useState} from 'react';
import {api} from '../platform.js';

export function GameRules({gameId,version}:{gameId:string;version:string}) {
  const [rules,setRules]=useState('');
  const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let disposed=false;
    setRules('');setNotice('');setLoading(true);
    void api.gameRules(gameId,version).then(result=>{if(!disposed)setRules(result.rules);})
      .catch(()=>{if(!disposed)setNotice('规则暂时无法加载。');}).finally(()=>{if(!disposed)setLoading(false);});
    return()=>{disposed=true;};
  },[gameId,version,attempt]);
  async function copy() {
    try {await navigator.clipboard.writeText(rules);setNotice('规则已复制');}
    catch {setNotice('复制失败，请选择下方规则文字手动复制。');}
  }
  return <details className="game-rules panel detail-support-card">
    <summary>
      <div className="detail-support-trigger">
        <span className="detail-support-icon detail-support-icon--rules" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
            <path d="M6 6h10"/>
            <path d="M6 10h10"/>
          </svg>
        </span>
        <div className="detail-support-meta">
          <span className="detail-support-title">游戏规则</span>
          <span className="detail-support-desc">查阅胜负规则与流程说明</span>
        </div>
      </div>
      <span className="detail-support-chevron" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </span>
    </summary>
    <div className="detail-support-body">
      <div className="rules-content-box">
        <p className="rules-text">{rules||(loading?'正在加载规则…':'请检查连接后重新加载说明。')}</p>
      </div>
      <div className="rules-actions">
        {!loading&&!rules&&<button type="button" className="secondary" onClick={()=>setAttempt(value=>value+1)}>重新加载说明</button>}
        <button type="button" className="secondary rules-copy-btn" disabled={!rules} onClick={()=>void copy()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
          </svg>
          复制规则
        </button>
      </div>
      {notice&&<p className="rules-notice" role="status">{notice}</p>}
    </div>
  </details>;
}
