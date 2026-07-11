import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Download, Wrench, Activity } from 'lucide-react';
import { useDataIntegrityStore, type HealthIssue, type HealthCheckCategory } from '../store/dataIntegrity';

const categoryLabels: Record<HealthCheckCategory, string> = {
  tasks: '任务',
  groups: '分组',
  schedule: '排期',
  graph: '知识图谱',
  ebb: '复习',
  sync: '同步'
};

const categoryColors: Record<HealthCheckCategory, string> = {
  tasks: 'bg-blue-500',
  groups: 'bg-purple-500',
  schedule: 'bg-green-500',
  graph: 'bg-pink-500',
  ebb: 'bg-amber-500',
  sync: 'bg-slate-500'
};

const severityColors: Record<HealthIssue['severity'], string> = {
  warning: 'text-amber-500',
  error: 'text-red-500',
  critical: 'text-red-700'
};

const severityIcons: Record<HealthIssue['severity'], React.ReactNode> = {
  warning: <AlertTriangle size={16} />,
  error: <XCircle size={16} />,
  critical: <XCircle size={18} />
};

export const HealthCenterPanel: React.FC = () => {
  const {
    healthReport,
    healthPanelOpen,
    setHealthPanelOpen,
    runHealthCheck,
    fixIssue,
    fixAllIssues,
    exportReport
  } = useDataIntegrityStore();

  const [filterCategory, setFilterCategory] = useState<HealthCheckCategory | 'all'>('all');
  const [filterSeverity, setFilterSeverity] = useState<HealthIssue['severity'] | 'all'>('all');

  const filteredIssues = healthReport.issues.filter(issue => {
    if (filterCategory !== 'all' && issue.category !== filterCategory) return false;
    if (filterSeverity !== 'all' && issue.severity !== filterSeverity) return false;
    return true;
  });

  const stats = {
    total: healthReport.issues.length,
    fixable: healthReport.issues.filter(i => i.autoFixable).length,
    critical: healthReport.issues.filter(i => i.severity === 'critical').length,
    error: healthReport.issues.filter(i => i.severity === 'error').length,
    warning: healthReport.issues.filter(i => i.severity === 'warning').length
  };

  const handleExport = () => {
    const report = exportReport();
    const blob = new Blob([report], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `health-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getHealthStatus = () => {
    if (stats.total === 0) return 'healthy';
    if (stats.critical > 0) return 'critical';
    if (stats.error > 0) return 'error';
    return 'warning';
  };

  const healthStatus = getHealthStatus();

  return (
    <AnimatePresence>
      {healthPanelOpen && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm"
          onClick={() => setHealthPanelOpen(false)}
        />
      )}
      {healthPanelOpen && (
        <motion.div
          key="panel"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed right-0 top-0 h-full w-[500px] z-[9999] bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col"
        >
          {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              healthStatus === 'healthy' ? 'bg-green-500/20 text-green-400' :
              healthStatus === 'critical' ? 'bg-red-500/20 text-red-400' :
              healthStatus === 'error' ? 'bg-red-500/20 text-red-400' :
              'bg-amber-500/20 text-amber-400'
            }`}>
              <Activity size={24} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">数据健康中心</h2>
              <p className="text-sm text-slate-400">
                {healthReport.lastChecked
                  ? `上次检查: ${new Date(healthReport.lastChecked).toLocaleString()}`
                  : '尚未检查'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setHealthPanelOpen(false)}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Stats */}
        <div className="p-6 border-b border-slate-700">
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-slate-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">{stats.total}</div>
              <div className="text-xs text-slate-400">总问题</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{stats.fixable}</div>
              <div className="text-xs text-slate-400">可修复</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{stats.error}</div>
              <div className="text-xs text-slate-400">错误</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-400">{stats.warning}</div>
              <div className="text-xs text-slate-400">警告</div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={runHealthCheck}
              disabled={healthReport.isChecking}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <RefreshCw size={16} className={healthReport.isChecking ? 'animate-spin' : ''} />
              {healthReport.isChecking ? '检查中...' : '检查'}
            </button>
            {stats.fixable > 0 && (
              <button
                onClick={fixAllIssues}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
              >
                <Wrench size={16} />
                全部修复
              </button>
            )}
            {healthReport.issues.length > 0 && (
              <button
                onClick={handleExport}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                <Download size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-slate-700 flex gap-2">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value as any)}
            className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
          >
            <option value="all">全部分类</option>
            {Object.entries(categoryLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value as any)}
            className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
          >
            <option value="all">全部严重程度</option>
            <option value="warning">警告</option>
            <option value="error">错误</option>
            <option value="critical">严重</option>
          </select>
        </div>

        {/* Issue List */}
        <div className="flex-1 overflow-y-auto p-4">
          {healthReport.isChecking && (
            <div className="text-center py-12 text-slate-400">
              <div className="inline-block mb-4">
                <RefreshCw size={32} className="animate-spin text-blue-400" />
              </div>
              <p>正在检查数据健康...</p>
            </div>
          )}

          {!healthReport.isChecking && filteredIssues.length === 0 && (
            <div className="text-center py-12">
              <div className="inline-block mb-4 p-4 bg-green-500/20 rounded-full">
                <CheckCircle2 size={32} className="text-green-400" />
              </div>
              <p className="text-slate-300 font-medium">
                {healthReport.issues.length === 0 ? '数据很健康！' : '没有符合筛选条件的问题'}
              </p>
              <p className="text-slate-500 text-sm mt-1">
                {healthReport.issues.length === 0 ? '没有发现任何问题' : '请尝试调整筛选条件'}
              </p>
            </div>
          )}

          <div className="space-y-3">
            {filteredIssues.map(issue => (
              <motion.div
                key={issue.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-800 rounded-lg p-4 border border-slate-700"
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${categoryColors[issue.category]}/20`}>
                    <span className={severityColors[issue.severity]}>
                      {severityIcons[issue.severity]}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                        {categoryLabels[issue.category]}
                      </span>
                      <span className={`text-xs font-medium ${severityColors[issue.severity]}`}>
                        {issue.severity === 'warning' ? '警告' :
                         issue.severity === 'error' ? '错误' : '严重'}
                      </span>
                      {issue.autoFixable && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                          可自动修复
                        </span>
                      )}
                    </div>
                    <h3 className="text-white font-medium mb-1">{issue.title}</h3>
                    <p className="text-slate-400 text-sm mb-3">{issue.description}</p>
                    <p className="text-slate-500 text-xs">
                      影响: {issue.affectedIds.slice(0, 3).join(', ')}
                      {issue.affectedIds.length > 3 ? ` +${issue.affectedIds.length - 3}` : ''}
                    </p>
                  </div>
                  {issue.autoFixable && issue.fix && (
                    <button
                      onClick={() => fixIssue(issue.id)}
                      className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shrink-0"
                    >
                      <Wrench size={16} />
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  );
};
