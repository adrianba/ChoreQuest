/**
 * The Bounty Board — optional side quests for bonus XP.
 *
 * Kids:    Browse available bounties, accept, complete, and abandon them.
 * Parents: See all bounties (toggle is_bounty on chores via ChoreDetail),
 *          review completed claims, approve or reject.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ScrollText, CheckCircle2, Clock, XCircle, Loader2,
  Star, Sword, ChevronRight, AlertCircle, Camera, RefreshCw,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import ChoreIcon from '../components/ChoreIcon';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

const DIFFICULTY_COLORS = {
  easy: 'text-green-400',
  medium: 'text-yellow-400',
  hard: 'text-orange-400',
  expert: 'text-crimson',
};

const DIFFICULTY_LABELS = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

const STATUS_CONFIG = {
  claimed:   { label: 'In Progress', color: 'text-yellow-400', icon: Clock },
  completed: { label: 'Awaiting Approval', color: 'text-accent', icon: Clock },
  verified:  { label: 'Rewarded!', color: 'text-green-400', icon: CheckCircle2 },
  abandoned: { label: 'Abandoned', color: 'text-muted', icon: XCircle },
};

export default function BountyBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isParent = user?.role === 'parent' || user?.role === 'admin';

  const [bounties, setBounties] = useState([]);
  const [pendingClaims, setPendingClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const actionInFlight = useRef(false);
  const [tab, setTab] = useState('board'); // 'board' | 'review'
  const [abandonTarget, setAbandonTarget] = useState(null); // choreId pending confirmation
  const [noteTarget, setNoteTarget] = useState(null);       // choreId awaiting note input
  const [noteText, setNoteText] = useState('');
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoadError('');
    try {
      const data = await api('/api/bounty');
      setBounties(Array.isArray(data) ? data : []);
      if (isParent) {
        const claims = await api('/api/bounty/claims');
        setPendingClaims(Array.isArray(claims) ? claims : []);
      }
    } catch (err) {
      setLoadError(err.message || 'Could not load the Bounty Board');
    } finally {
      setLoading(false);
    }
  }, [isParent]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Refresh on WS bounty_changed events
  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (msg?.type === 'data_changed' && msg?.data?.entity === 'bounty') fetchData();
      if (msg?.type === 'bounty_verified') fetchData();
      if (msg?.type === 'pull_refresh') fetchData();
    };
    window.addEventListener('ws:message', handler);
    return () => window.removeEventListener('ws:message', handler);
  }, [fetchData]);

  const handleClaim = async (choreId) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionLoading(`claim-${choreId}`);
    try {
      await api(`/api/bounty/${choreId}/claim`, { method: 'POST' });
      showToast('Bounty accepted! Get to work!', 'success');
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Could not accept bounty', 'error');
    } finally {
      actionInFlight.current = false;
      setActionLoading('');
    }
  };

  const openNoteForm = (choreId) => {
    setNoteTarget(choreId);
    setNoteText('');
  };

  const handleComplete = async (choreId, note = '') => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setNoteTarget(null);
    setActionLoading(`complete-${choreId}`);
    try {
      const fd = new FormData();
      if (note.trim()) fd.append('kid_note', note.trim());
      await api(`/api/bounty/${choreId}/complete`, { method: 'POST', body: fd });
      showToast('Bounty turned in! Awaiting parent approval.', 'success');
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Could not mark bounty complete', 'error');
    } finally {
      actionInFlight.current = false;
      setActionLoading('');
    }
  };

  const handleAbandon = (choreId) => {
    setAbandonTarget(choreId);
  };

  const confirmAbandon = async () => {
    if (abandonTarget === null) return;
    const choreId = abandonTarget;
    const actionKey = `abandon-${choreId}`;
    if (actionLoading === actionKey) return;
    setActionLoading(actionKey);
    try {
      await api(`/api/bounty/${choreId}/claim`, { method: 'DELETE' });
      setAbandonTarget(null);
      showToast('Bounty abandoned.', 'info');
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Could not abandon bounty', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleVerify = async (claimId) => {
    setActionLoading(`verify-${claimId}`);
    try {
      await api(`/api/bounty/claims/${claimId}/verify`, { method: 'POST' });
      showToast('Bounty approved! XP awarded.', 'success');
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Could not approve claim', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleReject = async (claimId) => {
    setActionLoading(`reject-${claimId}`);
    try {
      await api(`/api/bounty/claims/${claimId}/reject`, { method: 'POST' });
      showToast('Claim sent back for revision.', 'info');
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Could not reject claim', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const handleResetClaims = async () => {
    setResetConfirmOpen(false);
    setActionLoading('reset-claims');
    try {
      const res = await api('/api/bounty/reset-claims', { method: 'POST' });
      showToast(`Reset ${res.reset ?? 0} verified claim(s) — board is fresh!`, 'success');
      await fetchData();
    } catch (err) {
      showToast(err.message || 'Could not reset claims', 'error');
    } finally {
      setActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-accent" size={24} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="game-panel p-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
            <ScrollText size={20} className="text-accent" />
          </div>
          <div className="flex-1">
            <h1 className="text-cream text-lg font-semibold">The Bounty Board</h1>
            <p className="text-muted text-xs">
              {isParent
                ? 'Optional side quests — toggle any chore as a bounty from its detail page'
                : 'Optional quests for bonus XP — no penalty for skipping!'}
            </p>
          </div>
          {isParent && (
            <button
              onClick={() => setResetConfirmOpen(true)}
              disabled={actionLoading === 'reset-claims'}
              title="Reset all verified claims so kids can claim again"
              className="game-btn game-btn-blue !py-1.5 !px-3 !text-xs flex items-center gap-1.5 flex-shrink-0"
            >
              {actionLoading === 'reset-claims'
                ? <Loader2 size={13} className="animate-spin" />
                : <RefreshCw size={13} />}
              Reset Claims
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="game-panel p-3 flex items-center gap-2 border-crimson/30 text-crimson text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />
          {loadError}
        </div>
      )}

      {/* Parent tabs */}
      {isParent && (
        <div className="flex gap-1 bg-surface-raised rounded-lg p-1">
          <button
            onClick={() => setTab('board')}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'board' ? 'bg-surface text-cream' : 'text-muted hover:text-cream'
            }`}
          >
            Active Board
          </button>
          <button
            onClick={() => setTab('review')}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors relative ${
              tab === 'review' ? 'bg-surface text-cream' : 'text-muted hover:text-cream'
            }`}
          >
            Review Claims
            {pendingClaims.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-crimson text-white text-[10px] font-bold min-w-[16px] h-[16px] flex items-center justify-center rounded-full px-1">
                {pendingClaims.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── BOARD TAB ── */}
      {tab === 'board' && (
        <>
          {bounties.length === 0 ? (
            <div className="game-panel p-10 flex flex-col items-center gap-3 text-center">
              <ScrollText size={36} className="text-muted" />
              <p className="text-muted text-sm">
                {isParent
                  ? 'No bounties yet. Open any quest and toggle "On Bounty Board" to add it here.'
                  : 'No bounties available right now. Check back later!'}
              </p>
              {isParent && (
                <button
                  onClick={() => navigate('/chores')}
                  className="game-btn game-btn-blue !py-2 !px-4 !text-sm flex items-center gap-2"
                >
                  <Sword size={14} />
                  Go to Quest Board
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {bounties.map((bounty) => (
                <BountyCard
                  key={bounty.id}
                  bounty={bounty}
                  isParent={isParent}
                  actionLoading={actionLoading}
                  onClaim={handleClaim}
                  onComplete={handleComplete}
                  onOpenNote={openNoteForm}
                  onAbandon={handleAbandon}
                  noteTarget={noteTarget}
                  noteText={noteText}
                  setNoteText={setNoteText}
                  setNoteTarget={setNoteTarget}
                  onNavigate={() => navigate(`/chores/${bounty.id}`)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── REVIEW TAB (parent only) ── */}
      {tab === 'review' && isParent && (
        <>
          {pendingClaims.length === 0 ? (
            <div className="game-panel p-10 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={36} className="text-muted" />
              <p className="text-muted text-sm">No bounties awaiting approval.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingClaims.map((claim) => (
                <ClaimReviewCard
                  key={claim.id}
                  claim={claim}
                  bounties={bounties}
                  actionLoading={actionLoading}
                  onVerify={handleVerify}
                  onReject={handleReject}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Confirmation modal for abandoning a bounty */}
      <Modal
        isOpen={abandonTarget !== null}
        onClose={() => { if (!actionLoading) setAbandonTarget(null); }}
        title="Abandon Bounty?"
        actions={[
          {
            label: 'Cancel',
            onClick: () => setAbandonTarget(null),
            className: 'game-btn game-btn-blue',
            disabled: !!actionLoading,
          },
          {
            label: actionLoading === `abandon-${abandonTarget}` ? 'Abandoning...' : 'Abandon',
            onClick: confirmAbandon,
            className: 'game-btn game-btn-red',
            disabled: !!actionLoading,
          },
        ]}
      >
        <p className="text-muted">
          Are you sure you want to abandon this bounty? Your in-progress work will be lost.
        </p>
      </Modal>

      {/* Confirmation modal for resetting verified claims */}
      <Modal
        isOpen={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        title="Reset All Verified Claims?"
        actions={[
          {
            label: 'Cancel',
            onClick: () => setResetConfirmOpen(false),
            className: 'game-btn game-btn-blue',
          },
          {
            label: 'Reset Now',
            onClick: handleResetClaims,
            className: 'game-btn game-btn-red',
          },
        ]}
      >
        <p className="text-muted text-sm">
          This will clear all approved bounty claims so kids can pick them up again.
          Useful if you want the board to refresh before the midnight reset.
          Claims still in progress won't be affected.
        </p>
      </Modal>

    </div>
  );
}


// ---------------------------------------------------------------------------
// BountyCard — shown on the board for both kids and parents
// ---------------------------------------------------------------------------

function BountyCard({ bounty, isParent, actionLoading, onClaim, onComplete, onOpenNote, onAbandon, onNavigate, noteTarget, noteText, setNoteText, setNoteTarget }) {
  const claim = bounty.my_claim;
  const statusCfg = claim ? (STATUS_CONFIG[claim.status] || STATUS_CONFIG.claimed) : null;
  const StatusIcon = statusCfg?.icon;
  const isBusy = (key) => actionLoading === key;
  const catColor = bounty.category?.colour || '#6366f1';

  return (
    <div className="game-panel p-4 transition-all" style={{ borderLeftColor: catColor, borderLeftWidth: 3 }}>
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${catColor}20` }}
        >
          <ChoreIcon name={bounty.icon} size={18} className="text-cream/70" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-cream text-sm font-semibold truncate">{bounty.title}</h3>
            {claim && statusCfg && (
              <span className={`flex items-center gap-1 text-xs font-medium ${statusCfg.color}`}>
                <StatusIcon size={12} />
                {statusCfg.label}
              </span>
            )}
          </div>

          {bounty.description && (
            <p className="text-muted text-xs mt-0.5 line-clamp-2">{bounty.description}</p>
          )}

          <div className="flex items-center gap-3 mt-2">
            <span className="flex items-center gap-1 text-accent text-xs font-bold">
              <Star size={11} />
              {bounty.points} XP
            </span>
            <span className={`text-xs font-medium ${DIFFICULTY_COLORS[bounty.difficulty] || 'text-muted'}`}>
              {DIFFICULTY_LABELS[bounty.difficulty] || bounty.difficulty}
            </span>
            {bounty.category && (
              <span className="text-muted text-xs">{bounty.category.name}</span>
            )}
            {bounty.requires_photo && (
              <span className="flex items-center gap-1 text-muted text-xs">
                <Camera size={11} />Photo
              </span>
            )}
            {isParent && bounty.claim_count > 0 && (
              <span className="text-muted text-xs">{bounty.claim_count} claimed</span>
            )}
          </div>
        </div>

        {/* Parent: navigate to detail */}
        {isParent && (
          <button onClick={onNavigate} className="text-muted hover:text-cream transition-colors p-1">
            <ChevronRight size={16} />
          </button>
        )}
      </div>

      {/* Kid action buttons */}
      {!isParent && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
          {(!claim || claim.status === 'abandoned') && (
            <button
              onClick={() => onClaim(bounty.id)}
              disabled={isBusy(`claim-${bounty.id}`)}
              className="game-btn game-btn-blue !py-1.5 !px-4 !text-xs flex items-center gap-1.5"
            >
              {isBusy(`claim-${bounty.id}`) ? <Loader2 size={12} className="animate-spin" /> : <ScrollText size={12} />}
              Accept Bounty
            </button>
          )}

          {claim?.status === 'claimed' && (
            <>
              {noteTarget === bounty.id ? (
                <div className="flex-1 space-y-2">
                  <textarea
                    autoFocus
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Describe what you found or did… (optional)"
                    maxLength={1000}
                    rows={3}
                    className="w-full field-input text-xs resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => onComplete(bounty.id, noteText)}
                      disabled={isBusy(`complete-${bounty.id}`)}
                      className="game-btn game-btn-blue !py-1.5 !px-3 !text-xs flex items-center gap-1.5"
                    >
                      {isBusy(`complete-${bounty.id}`) ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Submit
                    </button>
                    <button
                      onClick={() => setNoteTarget(null)}
                      className="text-muted hover:text-cream text-xs transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => onOpenNote(bounty.id)}
                    disabled={isBusy(`complete-${bounty.id}`)}
                    className="game-btn game-btn-blue !py-1.5 !px-4 !text-xs flex items-center gap-1.5"
                  >
                    {isBusy(`complete-${bounty.id}`) ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    Turn In
                  </button>
                  <button
                    onClick={() => onAbandon(bounty.id)}
                    disabled={isBusy(`abandon-${bounty.id}`)}
                    className="text-muted hover:text-crimson text-xs transition-colors"
                  >
                    Abandon
                  </button>
                </>
              )}
            </>
          )}

          {claim?.status === 'completed' && (
            <span className="text-accent text-xs font-medium flex items-center gap-1">
              <Clock size={12} />
              Waiting for parent approval…
            </span>
          )}

          {claim?.status === 'verified' && (
            <span className="text-green-400 text-xs font-medium flex items-center gap-1">
              <CheckCircle2 size={12} />
              Bounty rewarded — {bounty.points} XP earned!
            </span>
          )}
        </div>
      )}

      {/* Parent: per-kid claim statuses */}
      {isParent && bounty.claims.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
          {bounty.claims.map((c) => {
            const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.claimed;
            const Icon = cfg.icon;
            return (
              <div key={c.id} className="flex items-center justify-between text-xs">
                <span className="text-muted">{c.user_display_name || `User ${c.user_id}`}</span>
                <span className={`flex items-center gap-1 ${cfg.color}`}>
                  <Icon size={11} />
                  {cfg.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// ClaimReviewCard — parent approves/rejects completed claims
// ---------------------------------------------------------------------------

function ClaimReviewCard({ claim, bounties, actionLoading, onVerify, onReject }) {
  const bounty = bounties.find((b) => b.id === claim.chore_id);
  const isBusy = (key) => actionLoading === key;
  const title = claim.chore_title || bounty?.title || `Bounty #${claim.chore_id}`;

  return (
    <div className="game-panel p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
          <ChoreIcon name={bounty?.icon} size={18} className="text-accent opacity-80" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-cream text-sm font-semibold truncate">
            {title}
          </p>
          <p className="text-muted text-xs mt-0.5">
            Completed by <span className="text-cream">{claim.user_display_name || `User ${claim.user_id}`}</span>
          </p>
          {bounty && (
            <p className="text-accent text-xs font-bold mt-1 flex items-center gap-1">
              <Star size={11} />
              {bounty.points} XP reward
            </p>
          )}
          {claim.kid_note && (
            <div className="mt-2 p-2 rounded-md bg-surface-raised border border-border/50">
              <p className="text-muted text-[10px] uppercase tracking-wide font-semibold mb-0.5">Kid's note</p>
              <p className="text-cream text-xs leading-relaxed">{claim.kid_note}</p>
            </div>
          )}
          {claim.photo_proof_path && (
            <a
              href={`/api/uploads/${claim.photo_proof_path}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-accent text-xs mt-1 hover:underline"
            >
              <Camera size={11} />
              View photo proof
            </a>
          )}
        </div>
      </div>

      <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
        <button
          onClick={() => onVerify(claim.id)}
          disabled={isBusy(`verify-${claim.id}`)}
          className="game-btn game-btn-blue !py-1.5 !px-4 !text-xs flex items-center gap-1.5"
        >
          {isBusy(`verify-${claim.id}`) ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          Approve & Award XP
        </button>
        <button
          onClick={() => onReject(claim.id)}
          disabled={isBusy(`reject-${claim.id}`)}
          className="game-btn game-btn-red !py-1.5 !px-4 !text-xs flex items-center gap-1.5"
        >
          {isBusy(`reject-${claim.id}`) ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
          Send Back
        </button>
      </div>
    </div>
  );
}
