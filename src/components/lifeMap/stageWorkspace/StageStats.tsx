import type { StageStats as StageStatsData } from '@/lifeMap/selectors/lifeMapSelectors';

interface StageStatsProps { stats: StageStatsData; }

/** Compact supporting facts for the inspector header; progress lives with the progress bar. */
const StageStats: React.FC<StageStatsProps> = ({ stats }) => <div className="stage-workspace__stats" aria-label="阶段关联内容统计">
  <span><b>{stats.planCount}</b> 项目</span>
  <span><b>{stats.activeSystemCount}</b> 系统</span>
  <span><b>{stats.systemCheckInCount}</b> 打卡</span>
</div>;

export default StageStats;
