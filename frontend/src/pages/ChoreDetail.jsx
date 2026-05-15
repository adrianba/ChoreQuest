import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toast';
import { useTheme } from '../hooks/useTheme';
import { todayLocalISO } from '../utils/dates';
import { themedTitle, themedDescription } from '../utils/questThemeText';
import Modal from '../components/Modal';
import {
  ArrowLeft,
  Star,
  RefreshCw,
  Camera,
  CheckCircle2,
  XCircle,
  SkipForward,
  Calendar,
  Clock,
  Shield,
  Loader2,
  RotateCw,
  Trash2,
  ChevronRight,
  Users,
} from 'lucide-react';

const DIFFICULTY_LEVEL = { easy: 1, medium: 2, hard: 3, expert: 4 };
const DIFFICULTY_LABELS = ['Trivial', 'Easy', 'Medium', 'Hard', 'Legendary'];
const DIFFICULTY_COLORS = [
  'text-muted',
  'text-emerald',
  'text-accent',
  'text-purple',
  'text-gold',
];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// 0=Monday … 6=Sunday (matches Python's date.weekday())
const ROTATION_DAYS = [
  { value: 0, label: 'Monday' },
  { value: 1, label: 'Tuesday' },
  { value: 2, label: 'Wednesday' },
  { value: 3, label: 'Thursday' },
  { value: 4, label: 'Friday' },
  { value: 5, label: 'Saturday' },
  { value: 6, label: 'Sunday' },
];

const CATEGORY_COLORS = {
  cleaning: 'bg-accent/20 text-accent border-accent/40',
  cooking: 'bg-gold/20 text-gold border-gold/40',
  outdoor: 'bg-emerald/20 text-emerald border-emerald/40',
  homework: 'bg-purple/20 text-purple border-purple/40',
  pet_care: 'bg-crimson/20 text-crimson border-crimson/40',
  laundry: 'bg-accent/20 text-accent border-accent/40',
  errands: 'bg-gold/20 text-gold border-gold/40',
  default: 'bg-cream/10 text-muted border-border',
};

function DifficultyStars({ level }) {
  // level can be a string ("easy") or number — normalise to 1-based int
  const num = typeof level === 'string' ? (DIFFICULTY_LEVEL[level] || 1) : (level || 1);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={18}
          className={i <= num ? 'text-gold fill-gold' : 'text-cream/20'}
        />
      ))}
      <span className={`ml-2 text-sm ${DIFFICULTY_COLORS[num - 1] || 'text-muted'}`}>
        {DIFFICULTY_LABELS[num - 1] || 'Unknown'}
      </span>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    pending: 'bg-gold/20 text-gold border-gold/40',
    completed: 'bg-emerald/20 text-emerald border-emerald/40',
    verified: 'bg-accent/20 text-accent border-accent/40',
    skipped: 'bg-cream/10 text-muted border-border',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md text-sm border capitalize ${
        styles[status] || styles.pending
      }`}
    >
      {status || 'pending'}
    </span>
  );
}

export default function ChoreDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { colorTheme } = useTheme();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isParent = user?.role === 'parent' || user?.role === 'admin';
  const isKid = user?.role === 'kid';

  const [chore, setChore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const photoInputRef = useRef(null);
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'skip'|'uncomplete', assignmentId }
  const actionInFlight = useRef(false);

  useEffect(() => {
    setPhotoFile(null);
    if (photoInputRef.current) photoInputRef.current.value = '';
  }, [id]);
  // Rotation state (parent only)
  const [rotation, setRotation] = useState(null);
  const [allKids, setAllKids] = useState([]);
  const [selectedCadence, setSelectedCadence] = useState('weekly');
  const [selectedRotationDay, setSelectedRotationDay] = useState(0); // 0=Mon … 6=Sun
  const [assignmentRules, setAssignmentRules] = useState([]);

  const fetchRotation = useCallback(async () => {
    if (!isParent) return;
    try {
      const rotations = await api('/api/rotations');
      const match = (rotations || []).find((r) => r.chore_id === parseInt(id));
      setRotation(match || null);
    } catch { setRotation(null); }
  }, [id, isParent]);

  const fetchAssignmentRules = useCallback(async () => {
    if (!isParent) return;
    try {
      const rules = await api(`/api/chores/${id}/rules`);
      setAssignmentRules(Array.isArray(rules) ? rules.filter((r) => r.is_active) : []);
    } catch { setAssignmentRules([]); }
  }, [id, isParent]);

  const fetchChore = useCallback(async () => {
    try {
      setError('');
      const data = await api(`/api/chores/${id}`);
      setChore(data);
    } catch (err) {
      setError(err.message || 'This quest scroll could not be found.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchChore();
    fetchRotation();
    fetchAssignmentRules();
    if (isParent) {
      api('/api/stats/kids').then((data) => setAllKids(data || [])).catch(() => {});
    }
  }, [fetchChore, fetchRotation, fetchAssignmentRules, isParent]);

  // Live updates via WebSocket
  useEffect(() => {
    const handler = () => { fetchChore(); fetchRotation(); };
    window.addEventListener('ws:message', handler);
    return () => window.removeEventListener('ws:message', handler);
  }, [fetchChore, fetchRotation]);

  const handleComplete = async () => {
    if (chore?.requires_photo && !photoFile) return;
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionLoading('complete');
    try {
      if (chore?.requires_photo && photoFile) {
        const fd = new FormData();
        fd.append('file', photoFile);
        await api(`/api/chores/${id}/complete`, { method: 'POST', body: fd });
      } else {
        await api(`/api/chores/${id}/complete`, { method: 'POST' });
      }
      setPhotoFile(null);
      if (photoInputRef.current) photoInputRef.current.value = '';
      showToast('Quest completed! XP awarded! 🎉', 'success');
      await fetchChore();
    } catch (err) {
      showToast(err.message || 'Failed to complete the quest.', 'error');
    } finally {
      actionInFlight.current = false;
      setActionLoading('');
    }
  };

  const handleVerify = async (assignmentId) => {
    setActionLoading('verify');
    try {
      const path = assignmentId
        ? `/api/chores/assignments/${assignmentId}/verify`
        : `/api/chores/${id}/verify`;
      await api(path, { method: 'POST' });
      showToast('Quest verified! The hero has been rewarded.', 'success');
      await fetchChore();
    } catch (err) {
      showToast(err.message || 'Verification failed.', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleUncomplete = (assignmentId) => {
    setConfirmAction({ type: 'uncomplete', assignmentId });
  };

  const handleSkip = (assignmentId) => {
    setConfirmAction({ type: 'skip', assignmentId });
  };

  const confirmDestructiveAction = async () => {
    if (!confirmAction || actionLoading) return;
    const { type, assignmentId } = confirmAction;
    setActionLoading(type);
    try {
      if (type === 'uncomplete') {
        const path = assignmentId
          ? `/api/chores/assignments/${assignmentId}/uncomplete`
          : `/api/chores/${id}/uncomplete`;
        await api(path, { method: 'POST' });
        showToast('Quest marked as incomplete.', 'info');
      } else if (type === 'skip') {
        const path = assignmentId
          ? `/api/chores/assignments/${assignmentId}/skip`
          : `/api/chores/${id}/skip`;
        await api(path, { method: 'POST' });
        showToast('Quest skipped for today.', 'info');
      }
      await fetchChore();
      setConfirmAction(null);
    } catch (err) {
      const fallbackMessage =
        type === 'uncomplete'
          ? 'Could not mark quest as incomplete.'
          : type === 'skip'
            ? 'Could not skip quest for today.'
            : 'Action failed.';
      showToast(err.message || fallbackMessage, 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleCreateRotation = async () => {
    if (allKids.length < 2) { showToast('Need at least 2 kids for a rotation.', 'info'); return; }
    setActionLoading('rotation');
    try {
      await api('/api/rotations', {
        method: 'POST',
        body: {
          chore_id: parseInt(id),
          kid_ids: allKids.map((k) => k.id),
          cadence: selectedCadence,
          rotation_day: selectedRotationDay,
        },
      });
      await fetchRotation();
      showToast('Rotation created.', 'success');
    } catch (err) {
      showToast(err.message || 'Could not create rotation.', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleAdvanceRotation = async () => {
    if (!rotation) return;
    setActionLoading('rotation');
    try {
      await api(`/api/rotations/${rotation.id}/advance`, { method: 'POST' });
      await fetchRotation();
      showToast('Rotation advanced to next kid.', 'info');
    } catch (err) {
      showToast(err.message || 'Could not advance rotation.', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleUpdateCadence = async (newCadence) => {
    if (!rotation) return;
    setActionLoading('rotation');
    try {
      await api(`/api/rotations/${rotation.id}`, {
        method: 'PUT',
        body: { cadence: newCadence },
      });
      await fetchRotation();
      showToast(`Rotation cadence set to ${newCadence}.`, 'info');
    } catch (err) {
      showToast(err.message || 'Could not update cadence.', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleUpdateRotationDay = async (newDay) => {
    if (!rotation) return;
    setActionLoading('rotation');
    try {
      await api(`/api/rotations/${rotation.id}`, {
        method: 'PUT',
        body: { rotation_day: parseInt(newDay) },
      });
      await fetchRotation();
      setActionMessage(`Rotation day updated.`);
    } catch (err) {
      setActionMessage(err.message || 'Could not update rotation day.');
    } finally {
      setActionLoading('');
    }
  };

  const handleDeleteRotation = async () => {
    if (!rotation) return;
    setActionLoading('rotation');
    try {
      await api(`/api/rotations/${rotation.id}`, { method: 'DELETE' });
      setRotation(null);
      showToast('Rotation removed.', 'info');
    } catch (err) {
      showToast(err.message || 'Could not delete rotation.', 'error');
    } finally {
      setActionLoading('');
    }
  };

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-accent" size={24} />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="max-w-2xl mx-auto py-10">
        <button
          onClick={() => navigate('/chores')}
          className="flex items-center gap-2 text-muted hover:text-cream transition-colors mb-6"
        >
          <ArrowLeft size={18} />
          <span className="text-sm">Back to Quest Board</span>
        </button>
        <div className="game-panel p-10 text-center">
          <XCircle size={48} className="mx-auto text-crimson mb-4" />
          <p className="text-cream text-base font-semibold mb-2">Not Found</p>
          <p className="text-muted text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!chore) return null;

  const categoryName = typeof chore.category === 'object' ? chore.category?.name : chore.category;
  const categoryColorClass =
    CATEGORY_COLORS[categoryName?.toLowerCase()] || CATEGORY_COLORS.default;

  // Determine today's assignment.
  // kid_assignments is populated by the backend when a kid fetches a chore
  // so the Complete Quest button has the data it needs without a second API call.
  const assignments = chore.kid_assignments || chore.assignments || chore.history || [];
  const today = todayLocalISO();
  const todayAssignment = assignments.find(
    (a) => a.date === today || a.assigned_date === today || a.due_date === today
  );
  const hasPendingToday =
    todayAssignment && (todayAssignment.status === 'pending' || todayAssignment.status === 'assigned');
  const recentAssignments = assignments.slice(0, 10);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/chores')}
        className="flex items-center gap-2 text-muted hover:text-cream transition-colors"
      >
        <ArrowLeft size={18} />
        <span className="text-sm">Back to Quest Board</span>
      </button>

      {/* Main chore panel */}
      <div className="game-panel p-6 space-y-5">
        {/* Title */}
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-cream text-lg font-semibold leading-relaxed">
              {themedTitle(chore.title, colorTheme)}
            </h1>
          </div>
        </div>

        {/* Description */}
        {chore.description && (
          <div className="pl-10">
            <p className="text-muted text-sm leading-relaxed">
              {themedDescription(chore.title, chore.description, colorTheme)}
            </p>
          </div>
        )}

        {/* Divider */}
        <div className="mx-auto w-full h-[1px] bg-border" />

        {/* Stats grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* XP */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-gold/10 flex items-center justify-center">
              <span className="text-gold text-xl">&#9733;</span>
            </div>
            <div>
              <p className="text-muted text-xs font-medium">XP Reward</p>
              <p className="text-gold text-lg font-medium">{chore.points} XP</p>
            </div>
          </div>

          {/* Difficulty */}
          <div>
            <p className="text-muted text-xs font-medium mb-1">Difficulty</p>
            <DifficultyStars level={chore.difficulty || 1} />
          </div>

          {/* Category */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-surface-raised flex items-center justify-center">
              <Shield size={18} className="text-muted" />
            </div>
            <div>
              <p className="text-muted text-xs font-medium">Category</p>
              <span
                className={`inline-block px-2 py-0.5 rounded-md text-sm border capitalize ${categoryColorClass}`}
              >
                {categoryName || 'General'}
              </span>
            </div>
          </div>

          {/* Recurrence */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-surface-raised flex items-center justify-center">
              <RefreshCw size={18} className="text-muted" />
            </div>
            <div>
              <p className="text-muted text-xs font-medium">Recurrence</p>
              <p className="text-cream text-sm capitalize">
                {chore.recurrence || 'Once'}
                {chore.recurrence === 'custom' &&
                  chore.custom_days?.length > 0 && (
                    <span className="text-muted text-xs ml-1">
                      ({chore.custom_days.map((d) => DAY_NAMES[d] || d).join(', ')})
                    </span>
                  )}
              </p>
            </div>
          </div>
        </div>

        {/* Photo requirement */}
        {chore.requires_photo && (
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-purple/10 border border-purple/30">
            <Camera size={16} className="text-purple" />
            <span className="text-purple text-xs">
              Photo proof required upon completion
            </span>
          </div>
        )}

        {/* Bounty Board toggle (parent only) */}
        {isParent && (
          <div className="flex items-center justify-between px-3 py-2 rounded bg-surface-raised border border-border">
            <div className="flex items-center gap-2">
              <span className="text-sm">📜</span>
              <div>
                <p className="text-cream text-xs font-medium">On Bounty Board</p>
                <p className="text-muted text-[11px]">Kids can optionally claim this for bonus XP</p>
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  const updated = await api(`/api/chores/${chore.id}`, {
                    method: 'PUT',
                    body: { is_bounty: !chore.is_bounty },
                  });
                  setChore(updated);
                } catch {
                  /* ignore */
                }
              }}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                chore.is_bounty ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  chore.is_bounty ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}
      </div>

      {/* Rotation info for kids */}
      {isKid && chore.rotation_summary && (
        <div
          className={`game-panel p-4 flex items-start gap-3 ${
            chore.rotation_summary.current_kid_id === user?.id
              ? 'border-purple/40 bg-purple/10'
              : 'border-border bg-surface-raised/30'
          }`}
        >
          <RotateCw
            size={16}
            className={`flex-shrink-0 mt-0.5 ${
              chore.rotation_summary.current_kid_id === user?.id
                ? 'text-purple'
                : 'text-muted'
            }`}
          />
          <div className="text-sm leading-snug">
            {chore.rotation_summary.current_kid_id === user?.id ? (
              <span className="text-cream">
                🔄 Rotating quest —{' '}
                <span className="font-semibold text-purple">it's your turn!</span>
              </span>
            ) : (
              <span className="text-muted">
                🔄 Rotating quest — currently{' '}
                <span className="font-semibold text-cream">
                  {chore.rotation_summary.current_kid_name}
                </span>
                's turn. Check back next cycle.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actions for kids */}
      {isKid && hasPendingToday && (
        <div className="game-panel p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-cream text-sm font-semibold mb-1">Today's Quest</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {chore.requires_photo && (
                <label className="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer hover:text-cream transition-colors bg-surface-raised px-2.5 py-1.5 rounded-md border border-border">
                  <Camera size={12} />
                  <span>{photoFile ? photoFile.name : 'Attach proof photo'}</span>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                  />
                </label>
              )}
              <button
                onClick={handleComplete}
                disabled={!!actionLoading || (chore.requires_photo && !photoFile)}
                className={`game-btn game-btn-blue flex items-center gap-2 ${
                  actionLoading === 'complete' ? 'opacity-60 cursor-wait' : ''
                } ${chore.requires_photo && !photoFile ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <CheckCircle2 size={16} />
                {actionLoading === 'complete' ? 'Completing...' : 'Complete Quest'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actions for parents */}
      {isParent && (
        <div className="game-panel p-5">
          <p className="text-cream text-sm font-semibold mb-3">Actions</p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleVerify(todayAssignment?.id)}
              disabled={!!actionLoading}
              className={`game-btn game-btn-blue flex items-center gap-2 ${
                actionLoading === 'verify' ? 'opacity-60 cursor-wait' : ''
              }`}
            >
              <CheckCircle2 size={14} />
              {actionLoading === 'verify' ? 'Verifying...' : 'Verify'}
            </button>
            <button
              onClick={() => handleUncomplete(todayAssignment?.id)}
              disabled={!!actionLoading}
              className={`game-btn game-btn-blue flex items-center gap-2 ${
                actionLoading === 'uncomplete' ? 'opacity-60 cursor-wait' : ''
              }`}
            >
              <XCircle size={14} />
              {actionLoading === 'uncomplete' ? 'Undoing...' : 'Uncomplete'}
            </button>
            <button
              onClick={() => handleSkip(todayAssignment?.id)}
              disabled={!!actionLoading}
              className={`game-btn game-btn-red flex items-center gap-2 ${
                actionLoading === 'skip' ? 'opacity-60 cursor-wait' : ''
              }`}
            >
              <SkipForward size={14} />
              {actionLoading === 'skip' ? 'Skipping...' : 'Skip Today'}
            </button>
          </div>
        </div>
      )}

      {/* Assignment Rules Panel (parent only) */}
      {isParent && assignmentRules.length > 0 && (
        <div className="game-panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-accent" />
            <h2 className="text-cream text-sm font-semibold">Assigned To</h2>
          </div>

          {/* When a rotation is active, the rotation controls assignment —
              show a single "currently" line instead of listing all kids,
              which would falsely imply all of them do the chore at once. */}
          {rotation ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-purple/30 bg-purple/10">
              <RotateCw size={14} className="text-purple flex-shrink-0" />
              <span className="text-sm text-cream">
                Rotation active — currently{' '}
                <span className="font-semibold text-purple">
                  {(() => {
                    const currentKidId = rotation.kid_ids?.[rotation.current_index];
                    const currentKid = allKids.find((k) => k.id === currentKidId);
                    return currentKid?.display_name || `Kid #${currentKidId}`;
                  })()}
                </span>
                's turn
              </span>
              <span className="text-muted text-xs ml-auto capitalize">
                {rotation.cadence}
                {(rotation.cadence === 'weekly' || rotation.cadence === 'fortnightly') &&
                  ` · every ${ROTATION_DAYS[rotation.rotation_day ?? 0]?.label}`}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              {assignmentRules.map((rule) => {
                const kid = allKids.find((k) => k.id === rule.user_id);
                return (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border bg-surface-raised/20"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-cream text-sm font-medium truncate">
                        {kid?.display_name || rule.user?.display_name || `Kid #${rule.user_id}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-muted text-xs capitalize flex items-center gap-1">
                        <RefreshCw size={10} />
                        {rule.recurrence}
                      </span>
                      {rule.requires_photo && (
                        <span className="text-muted text-xs flex items-center gap-1">
                          <Camera size={10} />
                          Photo
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Rotation Panel (parent only, recurring chores) */}
      {isParent && chore.recurrence && chore.recurrence !== 'once' && (
        <div className="game-panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <RotateCw size={18} className="text-purple" />
            <h2 className="text-cream text-sm font-semibold">Kid Rotation</h2>
          </div>

          {rotation ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted">Cadence:</span>
                  <select
                    value={rotation.cadence}
                    onChange={(e) => handleUpdateCadence(e.target.value)}
                    disabled={actionLoading === 'rotation'}
                    className="bg-surface-raised text-cream text-sm rounded-md border border-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                {(rotation.cadence === 'weekly' || rotation.cadence === 'fortnightly') && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted">Rotates on:</span>
                    <select
                      value={rotation.rotation_day ?? 0}
                      onChange={(e) => handleUpdateRotationDay(e.target.value)}
                      disabled={actionLoading === 'rotation'}
                      className="bg-surface-raised text-cream text-sm rounded-md border border-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple"
                    >
                      {ROTATION_DAYS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {(rotation.kid_ids || []).map((kidId, idx) => {
                  const kid = allKids.find((k) => k.id === kidId);
                  const isCurrent = idx === rotation.current_index;
                  return (
                    <span
                      key={kidId}
                      className={`px-3 py-1 rounded-md text-xs font-medium border ${
                        isCurrent
                          ? 'border-purple bg-purple/20 text-purple'
                          : 'border-border text-muted'
                      }`}
                    >
                      {kid?.display_name || `Kid #${kidId}`}
                      {isCurrent && ' (current)'}
                    </span>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleAdvanceRotation}
                  disabled={actionLoading === 'rotation'}
                  className="game-btn game-btn-purple flex items-center gap-1.5 !py-1.5 !px-3 !text-[11px]"
                >
                  <ChevronRight size={14} />
                  Advance
                </button>
                <button
                  onClick={handleDeleteRotation}
                  disabled={actionLoading === 'rotation'}
                  className="game-btn game-btn-red flex items-center gap-1.5 !py-1.5 !px-3 !text-[11px]"
                >
                  <Trash2 size={14} />
                  Remove Rotation
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-muted text-xs">
                No rotation set. Create one to automatically rotate this quest between kids.
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted">Cadence:</span>
                  <select
                    value={selectedCadence}
                    onChange={(e) => setSelectedCadence(e.target.value)}
                    className="bg-surface-raised text-cream text-sm rounded-md border border-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                {(selectedCadence === 'weekly' || selectedCadence === 'fortnightly') && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted">Rotates on:</span>
                    <select
                      value={selectedRotationDay}
                      onChange={(e) => setSelectedRotationDay(parseInt(e.target.value))}
                      className="bg-surface-raised text-cream text-sm rounded-md border border-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple"
                    >
                      {ROTATION_DAYS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <button
                onClick={handleCreateRotation}
                disabled={actionLoading === 'rotation' || allKids.length < 2}
                className="game-btn game-btn-purple flex items-center gap-1.5 !py-1.5 !px-3 !text-[11px]"
              >
                <RotateCw size={14} />
                {allKids.length < 2 ? 'Need 2+ kids' : 'Create Rotation'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Assignment History */}
      {recentAssignments.length > 0 && (
        <div className="game-panel p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-accent" />
            <h2 className="text-cream text-sm font-semibold">History</h2>
          </div>

          <div className="space-y-2">
            {recentAssignments.map((assignment, idx) => (
              <div
                key={assignment.id || idx}
                className="flex items-center justify-between p-3 rounded bg-surface-raised/30 border border-border"
              >
                <div className="flex items-center gap-3">
                  <Clock size={14} className="text-cream/30" />
                  <span className="text-muted text-xs">
                    {assignment.date || assignment.assigned_date || assignment.due_date || 'N/A'}
                  </span>
                  {assignment.assigned_to_name && (
                    <span className="text-muted text-xs">
                      - {assignment.assigned_to_name}
                    </span>
                  )}
                </div>
                <StatusBadge status={assignment.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation modal for destructive actions */}
      <Modal
        isOpen={!!confirmAction}
        onClose={() => { if (!actionLoading) setConfirmAction(null); }}
        title={confirmAction?.type === 'skip' ? 'Skip Quest Today?' : 'Uncomplete Quest?'}
        actions={[
          {
            label: 'Cancel',
            onClick: () => setConfirmAction(null),
            className: 'game-btn game-btn-blue',
            disabled: !!actionLoading,
          },
          {
            label: actionLoading
              ? (confirmAction?.type === 'skip' ? 'Skipping...' : 'Undoing...')
              : (confirmAction?.type === 'skip' ? 'Skip Today' : 'Uncomplete'),
            onClick: confirmDestructiveAction,
            className: 'game-btn game-btn-red',
            disabled: !!actionLoading,
          },
        ]}
      >
        <p className="text-muted">
          {confirmAction?.type === 'skip'
            ? "Are you sure you want to skip this quest today? The hero will lose today's opportunity to earn XP."
            : 'Are you sure you want to mark this quest as incomplete? The XP award will be rolled back.'}
        </p>
      </Modal>

    </div>
  );
}
