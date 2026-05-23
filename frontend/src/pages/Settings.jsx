import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import {
  Settings as CogIcon,
  Save,
  Shield,
  Loader2,
  Award,
  ArrowLeft,
  GitCommit,
  RefreshCw,
  ArrowUpCircle,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  Link2,
  Copy,
  Trash2,
  LayoutDashboard,
} from 'lucide-react';
import VacationSettings from '../components/VacationSettings';

function UpdatePanel({ isAdmin }) {
  const [version, setVersion] = useState(null);
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null); // null = not checked yet
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');

  // Load current version from health endpoint on mount
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setVersion(d))
      .catch(() => {});
  }, []);

  // Auto-check for updates on mount, reusing cached result from Layout if available
  useEffect(() => {
    const cached = sessionStorage.getItem('cq_update_checked');
    if (cached) {
      // Re-use what Layout already fetched — just trigger the visual check silently
      checkForUpdates();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkForUpdates = async () => {
    setChecking(true);
    setUpdateInfo(null);
    setTriggerMsg('');
    try {
      const res = await fetch('/api/admin/update/check', {
        headers: { Authorization: `Bearer ${localStorage.getItem('chorequest_access_token')}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Check failed');
      setUpdateInfo(data);
    } catch (err) {
      setUpdateInfo({ error: err.message });
    } finally {
      setChecking(false);
    }
  };

  const applyUpdate = async () => {
    setTriggering(true);
    setTriggerMsg('');
    try {
      const res = await fetch('/api/admin/update/trigger', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('chorequest_access_token')}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Trigger failed');
      // Dispatch event to show the full-screen update overlay
      window.dispatchEvent(new CustomEvent('app:update-triggered', {
        detail: { currentVersion: version?.version ?? null },
      }));
    } catch (err) {
      setTriggerMsg(`Error: ${err.message}`);
      setTriggering(false);
    }
  };

  return (
    <div className="game-panel p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted">
          <GitCommit size={14} />
          <span className="text-xs font-medium text-cream">Version</span>
        </div>
        {version?.version && version.version !== 'unknown' && (
          <p className="text-cream text-xs font-mono">{version.version}</p>
        )}
        {(!version?.version || version.version === 'unknown') && (
          <p className="text-muted text-xs font-mono">dev build</p>
        )}
      </div>

      {version?.build_date && version.build_date !== 'unknown' && (
        <p className="text-muted text-[11px]">
          Built {new Date(version.build_date).toLocaleString()}
        </p>
      )}

      {/* Update check — parents and admins can check; only admins can apply */}
      <div className="pt-1 border-t border-border/50 space-y-2">
        <button
          onClick={checkForUpdates}
          disabled={checking}
          className="game-btn game-btn-blue !py-1.5 !px-3 !text-xs flex items-center gap-1.5"
        >
          {checking
            ? <Loader2 size={12} className="animate-spin" />
            : <RefreshCw size={12} />}
          {checking ? 'Checking…' : 'Check for Updates'}
        </button>

        {/* Result */}
        {updateInfo && !updateInfo.error && (
          <div className={`rounded-md p-3 border text-xs space-y-1.5 ${
            updateInfo.update_available
              ? 'bg-accent/10 border-accent/30'
              : 'bg-emerald/10 border-emerald/30'
          }`}>
            {updateInfo.update_available ? (
              <>
                <div className="flex items-center gap-1.5 text-accent font-semibold">
                  <ArrowUpCircle size={13} />
                  Update available ({updateInfo.latest})
                </div>
                {updateInfo.commit_message && (
                  <p className="text-cream/80 line-clamp-2">{updateInfo.commit_message}</p>
                )}
                {updateInfo.commit_date && (
                  <p className="text-muted">
                    {new Date(updateInfo.commit_date).toLocaleString()} · {updateInfo.commit_author}
                  </p>
                )}
                {isAdmin && !triggerMsg && (
                  <button
                    onClick={applyUpdate}
                    disabled={triggering}
                    className="game-btn game-btn-blue !py-1.5 !px-3 !text-xs flex items-center gap-1.5 mt-2"
                  >
                    {triggering
                      ? <Loader2 size={12} className="animate-spin" />
                      : <ArrowUpCircle size={12} />}
                    {triggering ? 'Scheduling…' : 'Apply Update'}
                  </button>
                )}
                {!isAdmin && (
                  <p className="text-muted italic">Ask an admin to apply the update.</p>
                )}
              </>
            ) : (
              <div className="flex items-center gap-1.5 text-emerald font-medium">
                <CheckCircle2 size={13} />
                Up to date ({updateInfo.current})
              </div>
            )}
          </div>
        )}

        {updateInfo?.message && !updateInfo.update_available && !updateInfo.error && (
          <p className="text-muted text-xs italic">{updateInfo.message}</p>
        )}

        {updateInfo?.error && (
          <div className="flex items-center gap-1.5 text-crimson text-xs">
            <Wifi size={12} />
            {updateInfo.error}
          </div>
        )}

        {triggerMsg && (
          <div className={`flex items-start gap-1.5 text-xs p-2 rounded-md border ${
            triggerMsg.startsWith('Error')
              ? 'text-crimson border-crimson/30 bg-crimson/10'
              : 'text-accent border-accent/30 bg-accent/10'
          }`}>
            {triggerMsg.startsWith('Error')
              ? <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              : <CheckCircle2 size={12} className="flex-shrink-0 mt-0.5" />}
            {triggerMsg}
          </div>
        )}

        {isAdmin && (
          <p className="text-muted text-[11px] leading-relaxed">
            Requires <span className="font-mono text-cream/60">watchdog.sh</span> running on the host. See the repo for setup.
          </p>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const isParentOrAdmin = user?.role === 'parent' || user?.role === 'admin';

  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Achievements
  const [achievements, setAchievements] = useState([]);
  const [achievementsLoading, setAchievementsLoading] = useState(false);
  const [achievementsSaving, setAchievementsSaving] = useState({});

  // Dashboard share token
  const [dashboardToken, setDashboardToken] = useState(null);
  const [dashboardTokenLoading, setDashboardTokenLoading] = useState(false);
  const [dashboardCopied, setDashboardCopied] = useState(false);

  const fetchDashboardToken = useCallback(async () => {
    try {
      const data = await api('/api/admin/settings/dashboard-token');
      setDashboardToken(data.token);
    } catch {
      setDashboardToken(null);
    }
  }, []);

  const generateDashboardToken = async () => {
    setDashboardTokenLoading(true);
    try {
      const data = await api('/api/admin/settings/dashboard-token', { method: 'POST' });
      setDashboardToken(data.token);
    } catch { /* ignore */ } finally {
      setDashboardTokenLoading(false);
    }
  };

  const revokeDashboardToken = async () => {
    setDashboardTokenLoading(true);
    try {
      await api('/api/admin/settings/dashboard-token', { method: 'DELETE' });
      setDashboardToken(null);
    } catch { /* ignore */ } finally {
      setDashboardTokenLoading(false);
    }
  };

  const copyDashboardLink = () => {
    const url = `${window.location.origin}/view?token=${encodeURIComponent(dashboardToken)}`;
    navigator.clipboard.writeText(url).then(() => {
      setDashboardCopied(true);
      setTimeout(() => setDashboardCopied(false), 2000);
    });
  };

  // Settings are stored as strings in the DB — parse on load, stringify on save
  const parseSettings = (raw) => {
    const parsed = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === 'true') parsed[k] = true;
      else if (v === 'false') parsed[k] = false;
      else if (/^\d+$/.test(v)) parsed[k] = parseInt(v, 10);
      else parsed[k] = v;
    }
    return parsed;
  };

  const stringifySettings = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = String(v);
    }
    return out;
  };

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/admin/settings');
      setSettings(parseSettings(data));
    } catch (err) {
      if (err.message?.includes('403') || err.message?.includes('Forbidden') || err.message?.includes('permission')) {
        setError('Access denied. Only parents and admins can access settings.');
      } else {
        setError(err.message || 'Failed to load settings');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAchievements = useCallback(async () => {
    setAchievementsLoading(true);
    try {
      const data = await api('/api/stats/achievements/all');
      setAchievements(data.achievements || data || []);
    } catch {
      // Achievements endpoint may not exist
      setAchievements([]);
    } finally {
      setAchievementsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isParentOrAdmin) {
      fetchSettings();
      fetchAchievements();
      fetchDashboardToken();
    } else {
      setLoading(false);
      setError('Access denied. Only parents and admins can access settings.');
    }
  }, [isParentOrAdmin, fetchSettings, fetchAchievements, fetchDashboardToken]);

  const updateSetting = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const saveSettings = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { settings: stringifySettings(settings) } });
      setSaveMsg('Settings saved!');
      window.dispatchEvent(new CustomEvent('settings:updated'));
    } catch (err) {
      setSaveMsg(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const updateAchievementPoints = async (achievement) => {
    setAchievementsSaving((prev) => ({ ...prev, [achievement.id]: true }));
    try {
      await api(`/api/stats/achievements/${achievement.id}`, {
        method: 'PUT',
        body: { points_reward: achievement.points_reward },
      });
    } catch {
      // Revert will be handled by re-fetch if needed
    } finally {
      setAchievementsSaving((prev) => ({ ...prev, [achievement.id]: false }));
    }
  };

  const ToggleSwitch = ({ enabled, onChange, label, description, indent }) => (
    <div className={`flex items-start justify-between py-3 gap-3 ${indent ? 'pl-4 border-l-2 border-border/50' : ''}`}>
      <div className="min-w-0">
        <span className={`text-sm ${indent ? 'text-muted' : 'text-cream'}`}>{label}</span>
        {description && (
          <p className="text-xs text-muted/70 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors flex-shrink-0 mt-0.5 ${
          enabled
            ? 'bg-accent/30 border-accent/40'
            : 'bg-navy border-border'
        }`}
        aria-label={`Toggle ${label}`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full transition-transform ${
            enabled
              ? 'translate-x-6 bg-accent'
              : 'translate-x-1 bg-muted/60'
          }`}
        />
      </button>
    </div>
  );

  return (
    <div className="w-full max-w-2xl mx-auto overflow-hidden">
      {/* Back + Header */}
      <button
        onClick={() => navigate('/profile')}
        className="flex items-center gap-1.5 text-muted hover:text-cream transition-colors mb-4 text-sm"
      >
        <ArrowLeft size={16} />
        Profile
      </button>
      <div className="flex items-center gap-3 mb-6">
        <CogIcon size={24} className="text-cream" />
        <h1 className="text-cream text-lg font-semibold">
          Family Settings
        </h1>
      </div>

      {/* Error / Access denied */}
      {error && (
        <div className="game-panel p-8 text-center">
          <Shield size={48} className="text-crimson/30 mx-auto mb-4" />
          <p className="text-crimson text-sm">{error}</p>
          <p className="text-muted text-xs mt-2">
            Only parents and admins can change settings.
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-accent animate-spin" />
        </div>
      )}

      {/* Settings form */}
      {!loading && !error && settings && (
        <div className="space-y-6">
          {/* Toggle settings */}
          <div className="game-panel p-4">
            <h2 className="text-cream text-sm font-semibold mb-3">
              Feature Toggles
            </h2>

            <div className="divide-y divide-border">
              <ToggleSwitch
                enabled={settings.leaderboard_enabled ?? true}
                onChange={(v) => updateSetting('leaderboard_enabled', v)}
                label="Leaderboard"
              />
              <ToggleSwitch
                enabled={settings.spin_wheel_enabled ?? true}
                onChange={(v) => updateSetting('spin_wheel_enabled', v)}
                label="Spin Wheel"
              />
              {(settings.spin_wheel_enabled ?? true) && (
                <>
                  <ToggleSwitch
                    enabled={settings.spin_requires_verification ?? true}
                    onChange={(v) => updateSetting('spin_requires_verification', v)}
                    label="Spin requires parent verification"
                    description="When on, kids must have all quests verified by a parent before spinning. Prevents submitting fake completions just to unlock the wheel."
                    indent
                  />
                  <ToggleSwitch
                    enabled={settings.spin_high_scoring ?? false}
                    onChange={(v) => updateSetting('spin_high_scoring', v)}
                    label="Enable bonus spin rewards"
                    description="Higher scoring spin wheel — minimum 3 XP, most values 5–15. Great for rewarding a full day of completed chores."
                    indent
                  />
                </>
              )}
              <ToggleSwitch
                enabled={settings.chore_trading_enabled ?? true}
                onChange={(v) => updateSetting('chore_trading_enabled', v)}
                label="Chore Trading"
              />
              <ToggleSwitch
                enabled={settings.enable_debug_endpoints ?? false}
                onChange={(v) => updateSetting('enable_debug_endpoints', v)}
                label="Debug Endpoints"
                description="Enables /api/chores/{id}/debug for troubleshooting rotation and assignment issues. Requires parent login or API key."
              />
            </div>
          </div>

          {/* Daily reset hour */}
          <div className="game-panel p-4">
            <h2 className="text-cream text-sm font-semibold mb-3">
              Daily Reset Hour
            </h2>
            <p className="text-muted text-xs mb-3">
              Hour of day (0-23) when daily quests reset.
            </p>
            <input
              type="number"
              min={0}
              max={23}
              value={settings.daily_reset_hour ?? 0}
              onChange={(e) => {
                const val = Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0));
                updateSetting('daily_reset_hour', val);
              }}
              className="field-input max-w-[120px]"
            />
          </div>

          {/* Grace period */}
          <div className="game-panel p-4">
            <h2 className="text-cream text-sm font-semibold mb-3">
              Late Completion Grace Period
            </h2>
            <p className="text-muted text-xs mb-3">
              Number of days kids can mark a past quest as done (0 = today only, 1 = yesterday allowed, etc.).
            </p>
            <input
              type="number"
              min={0}
              max={7}
              value={settings.grace_period_days ?? 1}
              onChange={(e) => {
                const val = Math.min(7, Math.max(0, parseInt(e.target.value, 10) || 0));
                updateSetting('grace_period_days', val);
              }}
              className="field-input max-w-[120px]"
            />
          </div>

          {/* Save button */}
          <button
            onClick={saveSettings}
            disabled={saving}
            className="game-btn game-btn-blue flex items-center gap-2"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {saveMsg && (
            <p className={`text-sm ${saveMsg.includes('!') ? 'text-emerald' : 'text-crimson'}`}>
              {saveMsg}
            </p>
          )}

          {/* Achievement point values */}
          <div className="game-panel p-4">
            <h2 className="text-cream text-sm font-semibold mb-3 flex items-center gap-2">
              <Award size={16} className="text-muted" />
              Achievement Point Values
            </h2>

            {achievementsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 size={20} className="text-accent animate-spin" />
              </div>
            ) : achievements.length === 0 ? (
              <p className="text-muted text-xs">
                No achievements configured yet.
              </p>
            ) : (
              <div className="space-y-3">
                {achievements.map((ach) => {
                  const tierColors = { bronze: 'text-amber-500 bg-amber-600/10 border-amber-600/30', silver: 'text-slate-300 bg-slate-300/10 border-slate-300/30', gold: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' };
                  const tierStyle = tierColors[ach.tier] || '';
                  return (
                  <div
                    key={ach.id}
                    className="p-3 rounded-md bg-surface-raised/30 border border-border space-y-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-cream text-sm truncate">
                          {ach.title || ach.name}
                        </p>
                        {ach.tier && (
                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md border ${tierStyle}`}>
                            {ach.tier}
                          </span>
                        )}
                      </div>
                      {ach.description && (
                        <p className="text-muted text-xs">
                          {ach.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={ach.points_reward ?? 0}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10) || 0;
                          setAchievements((prev) =>
                            prev.map((a) =>
                              a.id === ach.id
                                ? { ...a, points_reward: val }
                                : a
                            )
                          );
                        }}
                        className="field-input !w-20 !p-2 text-center"
                      />
                      <span className="text-muted text-xs">pts</span>
                      <button
                        onClick={() => updateAchievementPoints(ach)}
                        disabled={achievementsSaving[ach.id]}
                        className="game-btn game-btn-blue !py-2 !px-3 ml-auto"
                        title="Save"
                      >
                        {achievementsSaving[ach.id] ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Save size={12} />
                        )}
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Vacation Mode */}
          <VacationSettings />

          {/* Share Dashboard */}
          <div className="game-panel p-4">
            <h2 className="text-cream text-sm font-semibold mb-1 flex items-center gap-2">
              <LayoutDashboard size={15} className="text-muted" />
              Public Family Dashboard
            </h2>
            <p className="text-muted text-xs mb-3">
              Generate a shareable read-only link to display all kids&apos; chore progress on a TV, tablet, or second screen — no login required.
            </p>

            {dashboardToken ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 rounded-md bg-surface-raised border border-border overflow-hidden">
                  <Link2 size={12} className="text-accent flex-shrink-0" />
                  <span className="text-xs text-muted truncate flex-1 font-mono">
                    {`${window.location.origin}/view?token=${dashboardToken}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyDashboardLink}
                    className="game-btn game-btn-blue !py-1.5 !px-3 !text-xs flex items-center gap-1.5"
                  >
                    {dashboardCopied ? (
                      <CheckCircle2 size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    {dashboardCopied ? 'Copied!' : 'Copy Link'}
                  </button>
                  <button
                    onClick={generateDashboardToken}
                    disabled={dashboardTokenLoading}
                    className="game-btn game-btn-blue !py-1.5 !px-3 !text-xs flex items-center gap-1.5"
                    title="Rotate token (old link will stop working)"
                  >
                    {dashboardTokenLoading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    Rotate
                  </button>
                  <button
                    onClick={revokeDashboardToken}
                    disabled={dashboardTokenLoading}
                    className="game-btn game-btn-red !py-1.5 !px-3 !text-xs flex items-center gap-1.5 ml-auto"
                    title="Revoke link"
                  >
                    {dashboardTokenLoading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    Revoke
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={generateDashboardToken}
                disabled={dashboardTokenLoading}
                className="game-btn game-btn-blue flex items-center gap-2 !text-xs !py-1.5 !px-3"
              >
                {dashboardTokenLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Link2 size={12} />
                )}
                Generate Share Link
              </button>
            )}
          </div>

          {/* Admin link */}
          {user?.role === 'admin' && (
            <div className="game-panel p-4 text-center">
              <p className="text-muted text-xs mb-3">
                Need advanced controls?
              </p>
              <button
                onClick={() => navigate('/admin')}
                className="game-btn game-btn-purple"
              >
                <Shield size={14} className="inline mr-2" />
                Admin Dashboard
              </button>
            </div>
          )}

          <UpdatePanel isAdmin={user?.role === 'admin'} />
        </div>
      )}
    </div>
  );
}
