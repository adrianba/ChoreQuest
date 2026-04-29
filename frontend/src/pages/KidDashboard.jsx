import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toLocalISO, todayLocalISO } from '../utils/dates';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Star,
  Sword,
  CheckCircle2,
  CheckCheck,
  Skull,
  Camera,
  Loader2,
  ChevronRight,
  Heart,
  HandHeart,
  Gamepad2,
  ShieldOff,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '../components/Toast';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useSettings } from '../hooks/useSettings';
import { useTheme } from '../hooks/useTheme';
import { themedTitle } from '../utils/questThemeText';
import PointCounter from '../components/PointCounter';
import StreakDisplay from '../components/StreakDisplay';
import SpinWheel from '../components/SpinWheel';
import ConfettiAnimation from '../components/ConfettiAnimation';
import RankBadge from '../components/RankBadge';
import PetLevelBadge from '../components/PetLevelBadge';
import { QuestBoardOverlay, QuestBoardPageGlow, QuestBoardParticles, QuestBoardDecorations, QuestBoardTitle, BOARD_THEMES, getTheme } from '../components/QuestBoardTheme';
import { renderPet, renderPetExtras, renderPetAccessory, buildPetColors } from '../components/avatar';

// ---------- helpers ----------

function getMondayOfThisWeek() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayISO() {
  return todayLocalISO();
}

function difficultyLabel(difficulty) {
  switch (difficulty) {
    case 'easy':
      return { text: 'Easy', color: 'text-emerald bg-emerald/10 border-emerald/20' };
    case 'medium':
      return { text: 'Medium', color: 'text-gold bg-gold/10 border-gold/20' };
    case 'hard':
      return { text: 'Hard', color: 'text-orange-400 bg-orange-400/10 border-orange-400/20' };
    case 'expert':
      return { text: 'Expert', color: 'text-crimson bg-crimson/10 border-crimson/20' };
    default:
      return { text: 'Easy', color: 'text-emerald bg-emerald/10 border-emerald/20' };
  }
}

// ---------- card animation variants ----------

const cardVariants = {
  hidden: { opacity: 0 },
  visible: (i) => ({
    opacity: 1,
    transition: { delay: i * 0.04, duration: 0.15 },
  }),
};

// ---------- component ----------

export default function KidDashboard() {
  const { user, updateUser } = useAuth();
  const { spin_wheel_enabled, spin_requires_verification, grace_period_days } = useSettings();
  const { colorTheme } = useTheme();
  const navigate = useNavigate();
  const { showToast } = useToast();

  // data state
  const [assignments, setAssignments] = useState([]);
  const [overdueAssignments, setOverdueAssignments] = useState([]);
  const [openPool, setOpenPool] = useState([]);
  const [claimingId, setClaimingId] = useState(null);
  const [chores, setChores] = useState([]);
  const [spinAvailability, setSpinAvailability] = useState(null);
  const [myStats, setMyStats] = useState(null);

  // ui state
  const [loading, setLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);

  // Pet interactions
  const [petInteracting, setPetInteracting] = useState(null);
  const [petAction, setPetAction] = useState(null); // holds last action for animation
  const [petMessage, setPetMessage] = useState('');
  const [interactionsRemaining, setInteractionsRemaining] = useState(3);

  // Board theme — stored in localStorage.
  // Wrapped in try/catch: iOS Safari throws SecurityError when localStorage is
  // restricted (Private Browsing, or Settings → Safari → Block All Cookies).
  // An unprotected call inside useState's lazy initializer runs during render
  // and — with no Error Boundary — unmounts the entire tree → blank screen.
  const [boardTheme, setBoardTheme] = useState(() => {
    try {
      return localStorage.getItem('chorequest-board-theme') || 'default';
    } catch {
      return 'default';
    }
  });
  const changeBoardTheme = (id) => {
    setBoardTheme(id);
    try { localStorage.setItem('chorequest-board-theme', id); } catch { /* storage restricted */ }
    setShowThemePicker(false);
  };

  // ---- data fetching ----

  const fetchData = useCallback(async () => {
    try {
      const monday = getMondayOfThisWeek();
      const today = todayISO();

      // Also fetch the previous week if the grace period might reach back that far
      const prevMonday = (() => {
        const d = new Date(monday + 'T00:00:00');
        d.setDate(d.getDate() - 7);
        return toLocalISO(d);
      })();

      const promises = [
        api('/api/chores'),
        api(`/api/calendar?week_start=${monday}`),
        grace_period_days > 0 ? api(`/api/calendar?week_start=${prevMonday}`) : Promise.resolve(null),
      ];
      if (spin_wheel_enabled) {
        promises.push(api('/api/spin/availability'));
      }
      promises.push(api('/api/stats/me'));

      const results = await Promise.all(promises);
      const choresRes = results[0];
      const calendarRes = results[1];
      const prevCalendarRes = results[2];
      const spinRes = spin_wheel_enabled ? results[3] : null;
      const statsRes = results[spin_wheel_enabled ? 4 : 3];
      if (statsRes) {
        setMyStats(statsRes);
        if (statsRes.interactions_remaining != null) {
          setInteractionsRemaining(statsRes.interactions_remaining);
        }
      }

      setChores(choresRes);

      // Filter calendar assignments to today and this user only
      const allToday = (calendarRes.days && calendarRes.days[today]) || [];
      const todayAssignments = allToday.filter((a) => a.user_id === user?.id);
      setAssignments(todayAssignments);

      // Collect pending assignments from past days within the grace window.
      // Exclude any chore that already has a completed/verified assignment today —
      // completing it again would give double XP and the backend would reject it.
      if (grace_period_days > 0) {
        const overdue = [];
        const allDays = {
          ...(calendarRes.days || {}),
          ...(prevCalendarRes?.days || {}),
        };
        const completedTodayChoreIds = new Set(
          todayAssignments
            .filter((a) => a.status === 'completed' || a.status === 'verified')
            .map((a) => a.chore_id)
        );
        for (let d = 1; d <= grace_period_days; d++) {
          const dt = new Date(today + 'T00:00:00');
          dt.setDate(dt.getDate() - d);
          const dayStr = toLocalISO(dt);
          const dayAssignments = (allDays[dayStr] || []).filter(
            (a) =>
              a.user_id === user?.id &&
              a.status === 'pending' &&
              !completedTodayChoreIds.has(a.chore_id)
          );
          overdue.push(...dayAssignments.map((a) => ({ ...a, _overdue_date: dayStr })));
        }
        setOverdueAssignments(overdue);
      } else {
        setOverdueAssignments([]);
      }

      setSpinAvailability(spinRes);

      // Fetch open-pool (critical chores needing coverage)
      try {
        const openPoolRes = await api('/api/chores/open-pool');
        setOpenPool(Array.isArray(openPoolRes) ? openPoolRes : []);
      } catch {
        setOpenPool([]);
      }
    } catch (err) {
      showToast(err.message || 'Failed to load quest data', 'error');
    } finally {
      setLoading(false);
    }
  }, [user?.id, spin_wheel_enabled, grace_period_days, showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---- WebSocket listener ----

  useEffect(() => {
    const handler = () => {
      fetchData();
    };
    window.addEventListener('ws:message', handler);
    return () => window.removeEventListener('ws:message', handler);
  }, [fetchData]);

  // ---- complete overdue quest ----

  const [completingOverdue, setCompletingOverdue] = useState(null);
  const completeInFlight = useRef(false);

  const handleCompleteOverdue = async (assignment) => {
    if (completeInFlight.current || completingOverdue) return;
    completeInFlight.current = true;
    setCompletingOverdue(assignment.id);
    try {
      await api(`/api/chores/${assignment.chore_id}/complete`, { method: 'POST' });
      // Optimistically remove the overdue card immediately so it doesn't linger
      setOverdueAssignments((prev) => prev.filter((a) => a.id !== assignment.id));
      setShowConfetti(true);
      showToast('Quest complete! XP awarded! 🎉', 'success');
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Could not complete quest', 'error');
      await fetchData();
    } finally {
      completeInFlight.current = false;
      setCompletingOverdue(null);
    }
  };

  // ---- complete today's quest inline ----

  const [completingToday, setCompletingToday] = useState(null);

  const handleCompleteToday = async (assignment) => {
    if (completeInFlight.current || completingToday) return;
    completeInFlight.current = true;
    setCompletingToday(assignment.id);
    try {
      await api(`/api/chores/${assignment.chore_id}/complete`, { method: 'POST' });
      // Optimistically mark as completed so the card disappears immediately
      setAssignments((prev) =>
        prev.map((a) => (a.id === assignment.id ? { ...a, status: 'completed' } : a))
      );
      setShowConfetti(true);
      showToast('Quest complete! XP awarded! 🎉', 'success');
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Could not complete quest', 'error');
    } finally {
      completeInFlight.current = false;
      setCompletingToday(null);
    }
  };

  // ---- claim open-pool assignment ----

  const handleClaimOpenPool = async (assignmentId) => {
    if (claimingId) return;
    setClaimingId(assignmentId);
    try {
      await api(`/api/chores/assignments/${assignmentId}/claim`, { method: 'POST' });
      setShowConfetti(true);
      showToast('You claimed the quest! Complete it to earn XP! 🏆', 'success');
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Could not claim quest', 'error');
    } finally {
      setClaimingId(null);
    }
  };

  // ---- pet interaction ----
  const handlePetInteraction = async (action) => {
    setPetInteracting(action);
    setPetAction(action);
    setPetMessage('');
    try {
      const res = await api('/api/pets/interact', { method: 'POST', body: { action } });
      setInteractionsRemaining(res.interactions_remaining);
      const labels = { feed: 'Fed', pet: 'Petted', play: 'Played with' };
      setPetMessage(`${labels[action]} your pet! +${res.xp_awarded} XP${res.levelup ? ' - LEVEL UP!' : ''}`);
      if (res.levelup) setShowConfetti(true);
      // Update points in header immediately
      if (res.new_balance != null) updateUser({ points_balance: res.new_balance });
      await fetchData();
    } catch (err) {
      setPetMessage(err.message || 'Could not interact with pet');
    } finally {
      setPetInteracting(null);
      setTimeout(() => { setPetAction(null); setPetMessage(''); }, 4000);
    }
  };

  const hasPet = !!myStats?.pet;
  const petType = myStats?.pet?.type || user?.avatar_config?.pet || 'none';
  const petColors = buildPetColors(user?.avatar_config || {});

  // ---- render ----

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-accent" size={24} />
      </div>
    );
  }

  const completedCount = assignments.filter(a => a.status === 'verified' || a.status === 'completed').length;
  const totalCount = assignments.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const activeTheme = getTheme(boardTheme);

  return (
    <div className={`max-w-2xl mx-auto space-y-5 quest-board-${boardTheme}`}>
      {/* ── Page-level ambient glow ── */}
      <QuestBoardPageGlow themeId={boardTheme} />

      {/* ── Confetti overlay ── */}
      <AnimatePresence>
        {showConfetti && (
          <ConfettiAnimation onComplete={() => setShowConfetti(false)} />
        )}
      </AnimatePresence>

      {/* ── Header with stats ── */}
      <div className="game-panel p-5 relative overflow-hidden">
        <QuestBoardOverlay themeId={boardTheme} />
        <QuestBoardParticles themeId={boardTheme} />
        <div className="relative z-10">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-cream text-lg font-semibold">
              <QuestBoardTitle themeId={boardTheme}>Quest Board</QuestBoardTitle>
            </h1>
            <button
              onClick={() => setShowThemePicker((v) => !v)}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg border border-border hover:border-accent hover:bg-accent/10 text-cream transition-all text-base"
              title="Change board theme"
            >
              {BOARD_THEMES.find((t) => t.id === boardTheme)?.icon || '\u2694\uFE0F'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <PointCounter value={user?.points_balance ?? 0} />
            <StreakDisplay streak={user?.current_streak ?? 0} />
          </div>
        </div>

        {/* Board theme decorations */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <QuestBoardDecorations themeId={boardTheme} />
          {myStats?.rank && <RankBadge rank={myStats.rank} size="sm" />}
          {myStats?.pet && <PetLevelBadge pet={myStats.pet} compact />}
        </div>

        {/* Progress bar */}
        {totalCount > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-muted text-xs font-medium">Today's Progress</span>
              <span className="text-cream text-xs font-bold">{completedCount}/{totalCount}</span>
            </div>
            <div className="xp-bar">
              <div
                className="xp-bar-fill"
                style={{ width: `${progressPct}%`, transition: 'width 0.3s ease' }}
              />
            </div>
          </div>
        )}
        </div>{/* close z-10 */}
      </div>

      {/* ── Board Theme Picker ── */}
      {showThemePicker && (
        <div className="game-panel p-4">
          <h3 className="text-cream text-xs font-medium mb-3">Choose Board Theme</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {BOARD_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => changeBoardTheme(t.id)}
                className={`flex items-center gap-2 p-3 rounded-md border transition-all text-left ${
                  boardTheme === t.id
                    ? 'border-accent bg-accent/10'
                    : 'border-border/50 bg-surface-raised/30 hover:border-border-light'
                }`}
              >
                <span className="text-xl">{t.icon}</span>
                <div>
                  <p className="text-cream text-xs font-medium">{t.label}</p>
                  <p className="text-muted text-[10px]">{t.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}


      {/* ── Needs Coverage — open-pool critical chores ── */}
      {openPool.length > 0 && (
        <div className="space-y-2">
          <p className="text-orange-400 text-xs font-semibold px-1 flex items-center gap-1">
            <ShieldAlert size={12} />
            Critical Quests Need Coverage — earn XP by helping out!
          </p>
          {openPool.map((a) => {
            const isClaiming = claimingId === a.id;
            const today = todayISO();
            const isToday = a.date === today;
            return (
              <motion.div
                key={a.id}
                className="game-panel p-4 border-orange-400/30 bg-orange-400/5"
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                custom={0}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-cream text-sm font-semibold truncate">
                      {a.chore?.title || 'Critical Chore'}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-gold text-xs font-semibold">
                        <Star size={11} fill="currentColor" />
                        {a.chore?.points} XP
                      </span>
                      <span className={`text-xs font-medium ${isToday ? 'text-orange-400' : 'text-muted'}`}>
                        {isToday ? 'Today' : a.date}
                      </span>
                    </div>
                  </div>
                  <button
                    className="game-btn game-btn-gold flex items-center gap-1.5 !text-xs flex-shrink-0"
                    disabled={!!claimingId}
                    onClick={() => handleClaimOpenPool(a.id)}
                  >
                    {isClaiming ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <HandHeart size={12} />
                    )}
                    Take It
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Overdue quests (grace period) ── */}
      {overdueAssignments.length > 0 && (
        <div className="space-y-2">
          <p className="text-crimson text-xs font-semibold px-1 flex items-center gap-1">
            <AlertTriangle size={12} />
            Forgotten Quests — mark these done if you completed them!
          </p>
          {overdueAssignments.map((assignment, idx) => {
            const chore = assignment.chore;
            if (!chore) return null;
            const diff = difficultyLabel(chore.difficulty);
            const categoryColor = chore.category?.colour || '#14b8a6';
            const daysAgo = Math.round(
              (new Date().setHours(0,0,0,0) - new Date(assignment._overdue_date + 'T00:00:00')) / 86400000
            );
            const isCompleting = completingOverdue === assignment.id;
            return (
              <motion.div
                key={assignment.id}
                className="game-panel p-4 border-crimson/30 transition-all"
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                custom={idx}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-1 h-12 rounded-full flex-shrink-0 bg-crimson/60" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <h3 className="text-cream text-sm font-semibold truncate">
                        {themedTitle(chore.title, colorTheme)}
                      </h3>
                      <span className="text-crimson text-[10px] font-bold flex-shrink-0 bg-crimson/10 border border-crimson/30 px-1.5 py-0.5 rounded">
                        {daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="inline-flex items-center gap-1 text-gold text-xs font-semibold">
                        <Star size={12} fill="currentColor" />
                        {chore.points} XP
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${diff.color}`}>
                        {diff.text}
                      </span>
                      {chore.category?.name && (
                        <span className="text-muted text-xs">{chore.category.name}</span>
                      )}
                      {chore.requires_photo && (
                        <span className="inline-flex items-center gap-1 text-muted text-xs">
                          <Camera size={10} />
                          Photo
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleCompleteOverdue(assignment)}
                      disabled={isCompleting || !!completingOverdue}
                      className="game-btn game-btn-blue !py-1.5 !px-3 !text-xs flex items-center gap-1.5"
                    >
                      {isCompleting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      {isCompleting ? 'Marking...' : 'Mark Done'}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Active Quest cards (pending only) ── */}
      {(() => {
        const pendingAssignments = assignments.filter(
          (a) => a.status === 'pending' || a.status === 'assigned'
        );

        if (pendingAssignments.length === 0 && !loading) {
          // Determine the right message based on verification state
          const awaitingVerification = spin_requires_verification
            && assignments.some((a) => a.status === 'completed');
          const allVerified = assignments.length > 0
            && assignments.every((a) => a.status === 'verified' || a.status === 'skipped');

          let doneMessage = 'No quests for today. Take a break!';
          if (assignments.length > 0) {
            if (awaitingVerification && !allVerified) {
              doneMessage = 'Quests submitted! Waiting for a parent to verify before you can spin 🕐';
            } else {
              doneMessage = 'All quests complete! Time to spin the wheel! 🎉';
            }
          }

          return (
            <motion.div
              className="game-panel p-10 flex flex-col items-center gap-3 text-center"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Sword size={36} className="text-muted" />
              <p className="text-muted text-sm">{doneMessage}</p>
            </motion.div>
          );
        }

        return (
          <div className="space-y-3">
            {pendingAssignments.map((assignment, idx) => {
              const chore = assignment.chore;
              if (!chore) return null;

              const diff = difficultyLabel(chore.difficulty);
              const categoryColor = chore.category?.colour || '#14b8a6';

              const isCompleting = completingToday === assignment.id;
              return (
                <motion.div
                  key={assignment.id}
                  className="game-panel p-4 transition-all cursor-pointer hover:border-accent/40"
                  style={activeTheme.cardAccent ? {
                    borderColor: `${activeTheme.cardAccent}25`,
                    boxShadow: `0 0 12px ${activeTheme.cardAccent}10, inset 0 1px 0 ${activeTheme.cardAccent}08`,
                  } : undefined}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  custom={idx}
                  onClick={() => navigate(`/chores/${chore.id}`)}
                >
                  <div className="flex items-start gap-3">
                    {/* Category indicator */}
                    <div
                      className="mt-0.5 w-1 h-12 rounded-full flex-shrink-0"
                      style={{ backgroundColor: categoryColor }}
                    />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <h3 className="text-cream text-sm font-semibold truncate">
                          {themedTitle(chore.title, colorTheme)}
                        </h3>
                        <ChevronRight size={16} className="text-muted flex-shrink-0" />
                      </div>

                      {/* Meta row */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="inline-flex items-center gap-1 text-gold text-xs font-semibold">
                          <Star size={12} fill="currentColor" />
                          {chore.points} XP
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${diff.color}`}>
                          {diff.text}
                        </span>
                        {chore.category?.name && (
                          <span className="text-muted text-xs">{chore.category.name}</span>
                        )}
                        {chore.requires_photo && (
                          <span className="inline-flex items-center gap-1 text-muted text-xs">
                            <Camera size={10} />
                            Photo
                          </span>
                        )}
                      </div>

                      {/* Action row */}
                      {chore.requires_photo ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/chores/${chore.id}`); }}
                          className="game-btn game-btn-blue !py-1.5 !px-3 !text-xs flex items-center gap-1.5"
                        >
                          <Camera size={12} />
                          Add Photo & Complete
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCompleteToday(assignment); }}
                          disabled={isCompleting || !!completingToday}
                          className="game-btn game-btn-blue !py-1.5 !px-3 !text-xs flex items-center gap-1.5"
                        >
                          {isCompleting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                          {isCompleting ? 'Marking...' : 'Mark Done'}
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Pet Interactions ── */}
      {hasPet && (() => {
        const config = user?.avatar_config || {};
        const petLevel = myStats?.pet?.level || 1;
        const petLevelName = myStats?.pet?.name || 'Hatchling';
        const petAccessory = config.pet_accessory;
        // Level-based scale (matches AvatarDisplay)
        const sc = 1 + (petLevel - 1) * 0.04;
        const glowColor = petLevel >= 7 ? '#f59e0b' : petLevel >= 5 ? '#a855f7' : null;
        // Pet center for 'right' position
        const px = 26, py = 20;

        return (
        <div className="game-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-cream text-sm font-semibold flex items-center gap-2">
              <Heart size={14} className="text-crimson" />
              Pet Care
            </h3>
            <span className="text-muted text-[11px]">
              {interactionsRemaining} interaction{interactionsRemaining !== 1 ? 's' : ''} left today
            </span>
          </div>

          {/* Pet display with idle + interaction animations */}
          <div className="flex flex-col items-center mb-3 gap-1">
            <div
              className={`pet-interaction-stage ${petAction ? `pet-action-${petAction}` : ''}`}
            >
              <div className="avatar-idle rounded-full overflow-hidden" style={{ width: 96, height: 96 }}>
                <svg width={96} height={96} viewBox="19 13 14 14">
                  <circle cx="26" cy="20" r="6.5" fill="rgba(255,255,255,0.06)" />
                  {glowColor && (
                    <circle cx={px} cy={py} r={4} fill={glowColor} opacity="0.15" />
                  )}
                  <g className="avatar-pet">
                    <g transform={sc !== 1 ? `translate(${px},${py}) scale(${sc}) translate(${-px},${-py})` : undefined}>
                      {renderPet(petType, petColors, 'right')}
                      {renderPetExtras(petType, petLevel, petColors, 'right')}
                      {renderPetAccessory(petType, petAccessory, 'right')}
                    </g>
                  </g>
                </svg>
              </div>
              {/* Floating particles during interaction */}
              <AnimatePresence>
                {petAction === 'feed' && (
                  <motion.span
                    className="absolute -top-1 right-0 text-lg pointer-events-none"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: -8 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6 }}
                  >
                    🍖
                  </motion.span>
                )}
                {petAction === 'pet' && (
                  <>
                    {[0, 1, 2].map(i => (
                      <motion.span
                        key={i}
                        className="absolute pointer-events-none text-sm"
                        style={{ left: `${20 + i * 25}%`, top: '-4px' }}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: [0, 1, 0], y: -16 }}
                        transition={{ duration: 0.8, delay: i * 0.2 }}
                      >
                        💕
                      </motion.span>
                    ))}
                  </>
                )}
                {petAction === 'play' && (
                  <>
                    {[0, 1].map(i => (
                      <motion.span
                        key={i}
                        className="absolute pointer-events-none text-sm"
                        style={{ left: `${15 + i * 50}%`, top: '-4px' }}
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: [0, 1, 0], scale: 1.2, y: -12 }}
                        transition={{ duration: 0.6, delay: i * 0.3 }}
                      >
                        ⭐
                      </motion.span>
                    ))}
                  </>
                )}
              </AnimatePresence>
            </div>
            {/* Pet level label */}
            <PetLevelBadge pet={myStats?.pet} />
          </div>

          {/* XP feedback */}
          <AnimatePresence>
            {petMessage && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`text-xs mb-3 text-center font-semibold ${
                  petMessage.includes('Could not') || petMessage.includes('tired') ? 'text-crimson' : 'text-emerald'
                }`}
              >
                {petMessage}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Action buttons */}
          <div className="flex gap-2">
            {[
              { action: 'feed', icon: Heart, label: 'Feed', color: 'game-btn-red' },
              { action: 'pet', icon: HandHeart, label: 'Pet', color: 'game-btn-blue' },
              { action: 'play', icon: Gamepad2, label: 'Play', color: 'game-btn-purple' },
            ].map(({ action, icon: Icon, label, color }) => (
              <button
                key={action}
                onClick={() => handlePetInteraction(action)}
                disabled={!!petInteracting || interactionsRemaining <= 0}
                className={`game-btn ${color} flex-1 flex items-center justify-center gap-1.5 !py-2 text-xs ${
                  petInteracting === action ? 'opacity-60 cursor-wait' : ''
                } ${interactionsRemaining <= 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {petInteracting === action ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Icon size={14} />
                )}
                {label}
              </button>
            ))}
          </div>
        </div>
        );
      })()}

      {/* ── Streak Freeze Indicator ── */}
      {myStats?.streak_freeze_available && (
        <div className="game-panel p-3 flex items-center gap-3">
          <ShieldOff size={16} className="text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-cream text-xs font-medium">Streak Freeze Available</p>
            <p className="text-muted text-[10px]">Your streak will be saved once if you miss a day this month</p>
          </div>
        </div>
      )}

      {/* ── Spin Wheel Section ── */}
      {spin_wheel_enabled && (
        <div className="pt-2">
          <SpinWheel
            availability={spinAvailability}
            onSpinComplete={() => {
              fetchData();
            }}
          />
        </div>
      )}
    </div>
  );
}
