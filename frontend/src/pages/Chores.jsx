import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toast';
import { toLocalISO } from '../utils/dates';
import { useTheme } from '../hooks/useTheme';
import { themedTitle, themedDescription } from '../utils/questThemeText';
import Modal from '../components/Modal';
import QuestCreateModal from '../components/QuestCreateModal';
import QuestAssignModal from '../components/QuestAssignModal';
import AvatarDisplay from '../components/AvatarDisplay';
import {
  Swords,
  Plus,
  Pencil,
  Trash2,
  Star,
  RefreshCw,
  Calendar,
  Camera,
  Filter,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Users,
  ScrollText,
  Zap,
  RotateCw,
  Search,
  X,
} from 'lucide-react';

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy', level: 1 },
  { value: 'medium', label: 'Medium', level: 2 },
  { value: 'hard', label: 'Hard', level: 3 },
  { value: 'expert', label: 'Expert', level: 4 },
];
const DIFFICULTY_LEVEL = { easy: 1, medium: 2, hard: 3, expert: 4 };
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const selectClass =
  'bg-navy-light border border-border text-cream p-2 rounded-md text-sm ' +
  'focus:border-accent focus:outline-none transition-colors';

function DifficultyStars({ level }) {
  const numLevel = typeof level === 'string' ? (DIFFICULTY_LEVEL[level] || 1) : (level || 1);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          size={12}
          className={i <= numLevel ? 'text-gold fill-gold' : 'text-muted'}
        />
      ))}
    </div>
  );
}

function CategoryBadge({ category }) {
  const catName = typeof category === 'object' ? category?.name : category;
  return (
    <span className="inline-block px-2 py-0.5 rounded-md text-xs border bg-surface-raised text-muted border-border capitalize">
      {catName || 'General'}
    </span>
  );
}

function RecurrenceIndicator({ recurrence, customDays }) {
  if (!recurrence || recurrence === 'once') return null;
  return (
    <div className="flex items-center gap-1 text-muted text-xs">
      <RefreshCw size={11} />
      <span className="capitalize">{recurrence}</span>
      {recurrence === 'custom' && customDays?.length > 0 && (
        <span className="text-muted">
          ({customDays.map((d) => DAY_NAMES[d] || d).join(', ')})
        </span>
      )}
    </div>
  );
}

function getMondayOfThisWeek() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayISO() {
  return toLocalISO(new Date());
}

export default function Chores() {
  const { user } = useAuth();
  const { colorTheme } = useTheme();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isParent = user?.role === 'parent' || user?.role === 'admin';
  const isKid = user?.role === 'kid';

  const [chores, setChores] = useState([]);
  const [categories, setCategories] = useState([]);
  const [kids, setKids] = useState([]);
  const [todayAssignments, setTodayAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState('library');

  const [filterCategory, setFilterCategory] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingChore, setEditingChore] = useState(null);
  const [assigningChore, setAssigningChore] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [completingId, setCompletingId] = useState(null);
  const completeInFlight = useRef(false);
  const [photoFiles, setPhotoFiles] = useState({});

  const fetchChores = useCallback(async () => {
    try {
      setError('');
      const data = await api('/api/chores');
      setChores(Array.isArray(data) ? data : data.chores || data.items || []);
    } catch (err) {
      setError(err.message || 'Failed to load quests.');
    }
  }, []);

  const fetchAssignments = useCallback(async () => {
    if (!isKid) return;
    try {
      const monday = getMondayOfThisWeek();
      const today = todayISO();
      const calendarRes = await api(`/api/calendar?week_start=${monday}`);
      const dayAssignments = (calendarRes.days && calendarRes.days[today]) || [];
      setTodayAssignments(dayAssignments);
    } catch {
      // Non-critical
    }
  }, [isKid]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await api('/api/chores/categories');
      setCategories(Array.isArray(data) ? data : data.categories || []);
    } catch {
      // Non-critical
    }
  }, []);

  const fetchKids = useCallback(async () => {
    if (!isParent) return;
    try {
      const data = await api('/api/stats/family');
      setKids(Array.isArray(data) ? data : []);
    } catch {
      try {
        const data = await api('/api/admin/users');
        const users = Array.isArray(data) ? data : data.users || [];
        setKids(users.filter((u) => u.role === 'kid'));
      } catch {
        // Non-critical
      }
    }
  }, [isParent]);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchChores(), fetchAssignments(), fetchCategories(), fetchKids()]);
  }, [fetchChores, fetchAssignments, fetchCategories, fetchKids]);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  useEffect(() => {
    const handler = () => { fetchChores(); fetchAssignments(); };
    window.addEventListener('ws:message', handler);
    return () => window.removeEventListener('ws:message', handler);
  }, [fetchChores, fetchAssignments]);

  const handleKidComplete = async (chore) => {
    if (completeInFlight.current) return;
    const choreId = chore.id;
    if (chore.requires_photo && !photoFiles[choreId]) return;
    completeInFlight.current = true;
    setCompletingId(choreId);
    try {
      let result;
      if (chore.requires_photo && photoFiles[choreId]) {
        const fd = new FormData();
        fd.append('file', photoFiles[choreId]);
        result = await api(`/api/chores/${choreId}/complete`, { method: 'POST', body: fd });
      } else {
        result = await api(`/api/chores/${choreId}/complete`, { method: 'POST' });
      }
      setPhotoFiles((prev) => { const next = { ...prev }; delete next[choreId]; return next; });
      // Use actual status from response so multi-completion chores (still pending) stay visible
      const newStatus = result?.status || 'completed';
      setTodayAssignments((prev) =>
        prev.map((a) => {
          const cid = a.chore_id || a.chore?.id;
          return cid === choreId
            ? { ...a, status: newStatus, completion_count: result?.completion_count || 1 }
            : a;
        })
      );
      const maxComp = chore.max_completions_per_day || 1;
      const newCount = result?.completion_count || 1;
      if (maxComp > 1 && newCount < maxComp) {
        showToast(`Done ${newCount}/${maxComp} times today! Keep going! 💪`, 'success');
      } else {
        showToast('Quest complete! Awaiting XP approval! 🎉', 'success');
      }
      await fetchAll();
    } catch (err) {
      showToast(err.message || 'Failed to complete quest', 'error');
    } finally {
      completeInFlight.current = false;
      setCompletingId(null);
    }
  };

  const assignmentStatusMap = {};
  const completionCountMap = {};
  if (isKid) {
    for (const a of todayAssignments) {
      const cid = a.chore_id || a.chore?.id;
      if (cid) {
        assignmentStatusMap[cid] = a.status;
        completionCountMap[cid] = a.completion_count || 0;
      }
    }
  }

  const libraryChores = chores;
  const activeChores = chores.filter((c) => (c.assignment_count || 0) > 0);

  const currentChores = isParent
    ? (activeTab === 'library' ? libraryChores : activeChores)
    : chores;

  const searchLower = searchQuery.trim().toLowerCase();
  const filteredChores = currentChores.filter((chore) => {
    if (filterCategory && chore.category?.name !== filterCategory) return false;
    if (filterDifficulty && chore.difficulty !== filterDifficulty) return false;
    if (isKid && !showCompleted) {
      const status = assignmentStatusMap[chore.id];
      if (status === 'completed' || status === 'verified') return false;
    }
    if (searchLower) {
      const inTitle = chore.title?.toLowerCase().includes(searchLower);
      const inDesc = chore.description?.toLowerCase().includes(searchLower);
      if (!inTitle && !inDesc) return false;
    }
    return true;
  });

  const completedCount = isKid
    ? Object.values(assignmentStatusMap).filter((s) => s === 'completed' || s === 'verified').length
    : 0;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/chores/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      showToast('Quest removed.', 'info');
      await fetchChores();
    } catch (err) {
      showToast(err.message || 'Failed to remove the quest.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-cream text-lg font-semibold">
          {isParent ? 'Quest Management' : 'My Quests'}
        </h1>
        <div className="flex items-center gap-2">
          {isKid && completedCount > 0 && (
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className="flex items-center gap-1.5 text-muted hover:text-cream text-sm transition-colors"
            >
              {showCompleted ? <EyeOff size={14} /> : <Eye size={14} />}
              {showCompleted ? 'Hide' : 'Show'} completed ({completedCount})
            </button>
          )}
          {isParent && (
            <button
              onClick={() => { setEditingChore(null); setShowCreateModal(true); }}
              className="game-btn game-btn-blue flex items-center gap-1.5"
            >
              <Plus size={14} />
              Create Quest
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-2.5 rounded-md border border-crimson/40 bg-crimson/10 text-crimson text-sm">
          {error}
        </div>
      )}

      {/* Parent Tabs */}
      {isParent && (
        <div className="flex gap-0.5 border-b border-border">
          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'library'
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-cream'
            }`}
          >
            <ScrollText size={14} />
            Library
            <span className="text-xs text-muted">({libraryChores.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('active')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'active'
                ? 'border-emerald text-emerald'
                : 'border-transparent text-muted hover:text-cream'
            }`}
          >
            <Zap size={14} />
            Active
            <span className="text-xs text-muted">({activeChores.length})</span>
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="game-panel p-3 space-y-2">
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search quests by title or description…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-navy-light border border-border text-cream pl-8 pr-8 py-2 rounded-md text-sm
                       focus:border-accent focus:outline-none transition-colors placeholder:text-muted/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-cream transition-colors"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Category + Difficulty filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex items-center gap-1.5 text-muted">
            <Filter size={14} />
            <span className="text-sm">Filters:</span>
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className={selectClass}
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.name}>{cat.name}</option>
            ))}
          </select>
          <select
            value={filterDifficulty}
            onChange={(e) => setFilterDifficulty(e.target.value)}
            className={selectClass}
          >
            <option value="">All Difficulties</option>
            {DIFFICULTY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chore List */}
      {filteredChores.length === 0 ? (
        <div className="game-panel p-8 text-center">
          <p className="text-muted text-sm">
            {chores.length === 0
              ? 'No quests created yet.'
              : searchLower
              ? `No quests match "${searchQuery}".`
              : isParent && activeTab === 'active'
              ? 'No active quests. Assign some from the Library.'
              : 'No quests match your filters.'}
          </p>
          {searchLower && (
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-accent text-sm hover:underline"
            >
              Clear search
            </button>
          )}
          {isParent && chores.length === 0 && (
            <button
              onClick={() => { setEditingChore(null); setShowCreateModal(true); }}
              className="game-btn game-btn-blue mt-3 inline-flex items-center gap-1.5"
            >
              <Plus size={14} />
              Create first quest
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredChores.map((chore) => {
            const kidStatus = isKid ? assignmentStatusMap[chore.id] : null;
            const isDone = kidStatus === 'completed' || kidStatus === 'verified';
            const isPending = isKid && (kidStatus === 'pending' || kidStatus === 'assigned');
            const isCompleting = completingId === chore.id;
            const assignCount = chore.assignment_count || 0;
            const isNotMyRotationTurn =
              isKid &&
              chore.rotation_summary &&
              chore.rotation_summary.current_kid_id !== user?.id;
            const maxCompletions = chore.max_completions_per_day || 1;
            const todayCompletionCount = completionCountMap[chore.id] || 0;

            return (
              <div
                key={chore.id}
                className={`game-panel p-3 flex flex-col gap-2 cursor-pointer hover:border-accent/40 transition-colors ${
                  isDone || isNotMyRotationTurn ? 'opacity-50' : ''
                }`}
                onClick={() => {
                  if (isParent && activeTab === 'library' && assignCount === 0) {
                    setAssigningChore(chore);
                  } else {
                    navigate(`/chores/${chore.id}`);
                  }
                }}
              >
                {/* Title row */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-cream text-sm font-medium flex-1">
                    {themedTitle(chore.title, colorTheme)}
                  </h3>
                  {isParent && (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          api(`/api/chores/${chore.id}`, {
                            method: 'PUT',
                            body: { is_bounty: !chore.is_bounty },
                          }).then(() => fetchChores()).catch(() => {});
                        }}
                        className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-surface-raised transition-colors ${
                          chore.is_bounty ? 'text-accent' : 'text-muted hover:text-accent'
                        }`}
                        aria-label={chore.is_bounty ? 'Remove from Bounty Board' : 'Add to Bounty Board'}
                        title={chore.is_bounty ? 'On Bounty Board — click to remove' : 'Add to Bounty Board'}
                      >
                        <ScrollText size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingChore(chore);
                          setShowCreateModal(true);
                        }}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-surface-raised transition-colors text-muted hover:text-accent"
                        aria-label="Edit quest"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(chore);
                        }}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-surface-raised transition-colors text-muted hover:text-crimson"
                        aria-label="Delete quest"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                  {isDone && (
                    <CheckCircle2 size={16} className="text-emerald flex-shrink-0" />
                  )}
                </div>

                {/* Description */}
                {chore.description && (
                  <p className="text-muted text-xs">
                    {themedDescription(chore.title, chore.description, colorTheme)}
                  </p>
                )}

                {/* Meta row */}
                <div className="flex items-center flex-wrap gap-2 mt-auto">
                  <span className="flex items-center gap-1 text-gold font-medium text-sm">
                    <Star size={12} fill="currentColor" />
                    {chore.points} XP
                  </span>
                  <DifficultyStars level={chore.difficulty || 1} />
                </div>

                {/* Bottom row */}
                <div className="flex items-center flex-wrap gap-1.5">
                  <CategoryBadge category={chore.category} />
                  <RecurrenceIndicator
                    recurrence={chore.recurrence}
                    customDays={chore.custom_days}
                  />
                  {chore.requires_photo && (
                    <span className="flex items-center gap-1 text-muted text-xs">
                      <Camera size={11} />
                      Photo
                    </span>
                  )}
                  {(chore.max_completions_per_day || 1) > 1 && (
                    <span className="flex items-center gap-1 text-accent text-xs border border-accent/30 rounded px-1.5 py-0.5">
                      <RefreshCw size={10} />
                      ×{chore.max_completions_per_day}/day
                    </span>
                  )}
                  {isParent && assignCount > 0 && (
                    <span className="flex items-center gap-1 text-emerald text-xs font-medium">
                      <Users size={11} />
                      {assignCount} assigned
                    </span>
                  )}
                  {isParent && assignCount === 0 && (
                    <span className="text-muted/60 text-xs">
                      Unassigned
                    </span>
                  )}
                  {isNotMyRotationTurn && (
                    <span className="flex items-center gap-1 text-muted text-xs border border-border rounded px-1.5 py-0.5">
                      <RotateCw size={10} />
                      Not your turn
                    </span>
                  )}
                </div>

                {/* Parent: assign button */}
                {isParent && activeTab === 'library' && assignCount === 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAssigningChore(chore);
                    }}
                    className="game-btn game-btn-gold w-full flex items-center justify-center gap-1.5 !text-xs !py-1.5"
                  >
                    <Users size={12} />
                    Assign
                  </button>
                )}

                {isParent && assignCount > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAssigningChore(chore);
                    }}
                    className="game-btn game-btn-purple w-full flex items-center justify-center gap-1.5 !text-xs !py-1.5"
                  >
                    <Users size={12} />
                    Manage
                  </button>
                )}

                {/* Kid: photo upload + complete */}
                {isPending && (
                  <div
                    className="mt-1 space-y-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {chore.requires_photo && (
                      <label className="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer hover:text-cream transition-colors bg-surface-raised px-2.5 py-1.5 rounded-md border border-border">
                        <Camera size={12} />
                        <span>
                          {photoFiles[chore.id]
                            ? photoFiles[chore.id].name
                            : 'Attach proof photo'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) =>
                            setPhotoFiles((prev) => ({
                              ...prev,
                              [chore.id]: e.target.files?.[0] || null,
                            }))
                          }
                        />
                      </label>
                    )}
                    <button
                      onClick={() => handleKidComplete(chore)}
                      disabled={
                        isCompleting ||
                        (chore.requires_photo && !photoFiles[chore.id])
                      }
                      className={`game-btn game-btn-blue w-full flex items-center justify-center gap-1.5 ${
                        isCompleting ? 'opacity-60 cursor-wait' : ''
                      } ${
                        chore.requires_photo && !photoFiles[chore.id]
                          ? 'opacity-40 cursor-not-allowed'
                          : ''
                      }`}
                    >
                      {isCompleting ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Completing...
                        </>
                      ) : maxCompletions > 1 ? (
                        <>
                          <CheckCircle2 size={12} />
                          Complete ({todayCompletionCount + 1}/{maxCompletions})
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={12} />
                          Complete Quest
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <QuestCreateModal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setEditingChore(null); }}
        onCreated={fetchChores}
        categories={categories}
        editingChore={editingChore}
      />

      <QuestAssignModal
        isOpen={!!assigningChore}
        onClose={() => setAssigningChore(null)}
        onAssigned={() => { fetchChores(); }}
        chore={assigningChore}
        kids={kids}
      />

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Remove Quest"
        actions={[
          {
            label: 'Cancel',
            onClick: () => setDeleteTarget(null),
            className: 'game-btn game-btn-blue',
          },
          {
            label: deleting ? 'Removing...' : 'Remove',
            onClick: handleDelete,
            className: 'game-btn game-btn-red',
            disabled: deleting,
          },
        ]}
      >
        <p className="text-muted">
          Are you sure you want to remove{' '}
          <span className="text-cream font-medium">
            "{themedTitle(deleteTarget?.title || '', colorTheme)}"
          </span>
          ? This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
