import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { todayLocalISO } from '../utils/dates';
import { Palmtree, Trash2, Plus, Loader2, Users, User, LogIn } from 'lucide-react';

export default function VacationSettings() {
  const [vacations, setVacations]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [scope, setScope]           = useState('family'); // 'family' | 'kid'
  const [selectedKid, setSelectedKid] = useState('');
  const [kids, setKids]             = useState([]);
  const [kidsLoading, setKidsLoading] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [earlyReturnId, setEarlyReturnId] = useState(null); // vacation id being trimmed
  const [earlyReturnDate, setEarlyReturnDate] = useState('');

  const fetchVacations = useCallback(async () => {
    try {
      const data = await api('/api/vacation');
      setVacations(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVacations(); }, [fetchVacations]);

  // Load kids list when the form opens so we have names for the dropdown
  useEffect(() => {
    if (!showForm) return;
    setKidsLoading(true);
    api('/api/stats/kids')
      .then((data) => setKids(data || []))
      .catch(() => {})
      .finally(() => setKidsLoading(false));
  }, [showForm]);

  const resetForm = () => {
    setShowForm(false);
    setStartDate('');
    setEndDate('');
    setScope('family');
    setSelectedKid('');
    setError('');
  };

  const create = async () => {
    if (!startDate || !endDate) return;
    if (scope === 'kid' && !selectedKid) {
      setError('Please select a hero');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api('/api/vacation', {
        method: 'POST',
        body: {
          start_date: startDate,
          end_date: endDate,
          user_id: scope === 'kid' ? parseInt(selectedKid, 10) : null,
        },
      });
      resetForm();
      fetchVacations();
    } catch (err) {
      setError(err.message || 'Failed to create vacation');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id) => {
    try {
      await api(`/api/vacation/${id}`, { method: 'DELETE' });
      fetchVacations();
    } catch {
      // ignore
    }
  };

  const confirmEarlyReturn = async () => {
    if (!earlyReturnId || !earlyReturnDate) return;
    setSaving(true);
    try {
      await api(`/api/vacation/${earlyReturnId}`, {
        method: 'PATCH',
        body: { end_date: earlyReturnDate },
      });
      setEarlyReturnId(null);
      setEarlyReturnDate('');
      fetchVacations();
    } catch (err) {
      setError(err.message || 'Failed to update vacation');
    } finally {
      setSaving(false);
    }
  };

  const today = todayLocalISO();

  return (
    <div className="game-panel p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-cream text-sm font-bold flex items-center gap-2">
          <Palmtree size={16} className="text-emerald" />
          Vacation Mode
        </h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs text-accent hover:text-accent-light transition-colors font-medium flex items-center gap-1"
        >
          <Plus size={12} />
          {showForm ? 'Cancel' : 'Schedule'}
        </button>
      </div>

      <p className="text-muted text-xs mb-3">
        During vacation, recurring quests are paused and streaks are preserved.
        You can put the whole family on vacation or just one hero.
      </p>

      {showForm && (
        <div className="mb-4 p-3 rounded-lg bg-surface-raised/50 border border-border/50 space-y-3">

          {/* Scope toggle */}
          <div>
            <p className="text-muted text-[10px] font-semibold uppercase mb-1.5">Who is on vacation?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setScope('family')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                  scope === 'family'
                    ? 'border-emerald/50 bg-emerald/10 text-emerald'
                    : 'border-border/50 text-muted hover:text-cream'
                }`}
              >
                <Users size={12} />
                Whole Family
              </button>
              <button
                onClick={() => setScope('kid')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                  scope === 'kid'
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-border/50 text-muted hover:text-cream'
                }`}
              >
                <User size={12} />
                One Hero
              </button>
            </div>
          </div>

          {/* Kid picker (shown when scope = kid) */}
          {scope === 'kid' && (
            <div>
              <label className="text-muted text-[10px] font-semibold uppercase">Hero</label>
              {kidsLoading ? (
                <div className="flex items-center gap-2 mt-1 text-muted text-xs">
                  <Loader2 size={12} className="animate-spin" /> Loading heroes…
                </div>
              ) : (
                <select
                  value={selectedKid}
                  onChange={(e) => setSelectedKid(e.target.value)}
                  className="field-input text-sm mt-1"
                >
                  <option value="">— Select hero —</option>
                  {kids.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.display_name || k.username}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-muted text-[10px] font-semibold uppercase">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={today}
                className="field-input text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-muted text-[10px] font-semibold uppercase">End</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || today}
                className="field-input text-sm mt-1"
              />
            </div>
          </div>

          {error && <p className="text-crimson text-xs">{error}</p>}

          <button
            onClick={create}
            disabled={saving || !startDate || !endDate || (scope === 'kid' && !selectedKid)}
            className="game-btn game-btn-blue w-full flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Palmtree size={12} />}
            Schedule Vacation
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 size={16} className="text-accent animate-spin" />
        </div>
      ) : vacations.length === 0 ? (
        <p className="text-muted text-xs text-center py-2">
          No vacations scheduled.
        </p>
      ) : (
        <div className="space-y-2">
          {vacations.map((v) => {
            const isPast    = v.end_date < today;
            const isActive  = v.start_date <= today && v.end_date >= today;
            const isPerKid  = !!v.user_id;
            return (
              <div
                key={v.id}
                className={`rounded-lg border ${
                  isActive
                    ? 'border-emerald/30 bg-emerald/5'
                    : isPast
                      ? 'border-border/30 bg-surface-raised/20 opacity-60'
                      : 'border-border/50 bg-surface-raised/20'
                }`}
              >
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-cream text-sm font-medium">
                        {v.start_date} &rarr; {v.end_date}
                      </p>
                      {isPerKid ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-accent/10 text-accent border border-accent/20">
                          <User size={8} />
                          {v.kid_name || `Kid #${v.user_id}`}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-emerald/10 text-emerald border border-emerald/20">
                          <Users size={8} />
                          Family
                        </span>
                      )}
                    </div>
                    {isActive && (
                      <p className="text-emerald text-[10px] font-semibold uppercase mt-0.5">
                        Active now
                      </p>
                    )}
                  </div>
                  {!isPast && (
                    <div className="flex items-center gap-1">
                      {isActive && earlyReturnId !== v.id && (
                        <button
                          onClick={() => { setEarlyReturnId(v.id); setEarlyReturnDate(today); setError(''); }}
                          className="text-muted hover:text-accent transition-colors p-1"
                          title="Return early — trim end date"
                        >
                          <LogIn size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => cancel(v.id)}
                        className="text-muted hover:text-crimson transition-colors p-1"
                        title="Cancel vacation entirely"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline early-return date picker */}
                {earlyReturnId === v.id && (
                  <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2">
                    <p className="text-muted text-[10px] font-semibold uppercase">Set new end date</p>
                    <input
                      type="date"
                      value={earlyReturnDate}
                      onChange={(e) => setEarlyReturnDate(e.target.value)}
                      min={today}
                      max={v.end_date}
                      className="field-input text-sm"
                    />
                    {error && <p className="text-crimson text-xs">{error}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={confirmEarlyReturn}
                        disabled={saving || !earlyReturnDate || earlyReturnDate >= v.end_date}
                        className="game-btn game-btn-blue !py-1 !px-3 !text-xs flex items-center gap-1"
                      >
                        {saving ? <Loader2 size={11} className="animate-spin" /> : <LogIn size={11} />}
                        We're Back!
                      </button>
                      <button
                        onClick={() => { setEarlyReturnId(null); setEarlyReturnDate(''); setError(''); }}
                        className="text-muted hover:text-cream text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
