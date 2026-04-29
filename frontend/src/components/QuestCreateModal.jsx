import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useTheme } from '../hooks/useTheme';
import { themedTitle, themedDescription } from '../utils/questThemeText';
import Modal from './Modal';
import {
  BookTemplate,
  Star,
  Scroll,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy', level: 1 },
  { value: 'medium', label: 'Medium', level: 2 },
  { value: 'hard', label: 'Hard', level: 3 },
  { value: 'expert', label: 'Expert', level: 4 },
];

const selectClass =
  'bg-navy-light border border-border text-cream p-2 rounded text-sm ' +
  'focus:border-accent focus:outline-none transition-colors';

const emptyForm = {
  title: '',
  description: '',
  points: 10,
  difficulty: 'easy',
  category_id: '',
  is_critical: false,
};

export default function QuestCreateModal({
  isOpen,
  onClose,
  onCreated,
  categories,
  editingChore,
}) {
  const { colorTheme } = useTheme();
  const [form, setForm] = useState({ ...emptyForm });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [existingTitles, setExistingTitles] = useState(new Set());

  useEffect(() => {
    if (isOpen) {
      if (editingChore) {
        setForm({
          title: editingChore.title || '',
          description: editingChore.description || '',
          points: editingChore.points || 10,
          difficulty: editingChore.difficulty || 'easy',
          category_id: editingChore.category_id ? String(editingChore.category_id) : '',
          is_critical: editingChore.is_critical || false,
        });
      } else {
        setForm({ ...emptyForm });
      }
      setFormError('');
      setShowTemplates(false);
    }
  }, [isOpen, editingChore]);

  useEffect(() => {
    if (isOpen && !editingChore) {
      Promise.all([
        api('/api/chores/templates').catch(() => []),
        api('/api/chores').catch(() => []),
      ]).then(([tplData, choreData]) => {
        setTemplates(Array.isArray(tplData) ? tplData : []);
        const titles = new Set(
          (Array.isArray(choreData) ? choreData : []).map((c) =>
            c.title.toLowerCase()
          )
        );
        setExistingTitles(titles);
      });
    }
  }, [isOpen, editingChore]);

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const applyTemplate = (tpl) => {
    const catMatch = categories.find(
      (c) => c.name.toLowerCase() === tpl.category_name.toLowerCase()
    );
    setForm({
      title: tpl.title,
      description: tpl.description || '',
      points: tpl.suggested_points,
      difficulty: tpl.difficulty,
      category_id: catMatch ? String(catMatch.id) : '',
    });
    setShowTemplates(false);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      setFormError('Every quest needs a name, adventurer!');
      return;
    }
    if (form.points < 1) {
      setFormError('The reward must be at least 1 XP.');
      return;
    }
    if (!form.category_id) {
      setFormError('Please select a category for this quest.');
      return;
    }

    setSubmitting(true);
    setFormError('');

    const body = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      points: Number(form.points),
      difficulty: form.difficulty,
      category_id: Number(form.category_id),
      // New quests from this flow don't set recurrence/photo on the chore itself
      recurrence: 'once',
      requires_photo: false,
      is_critical: form.is_critical,
      assigned_user_ids: [],
    };

    try {
      if (editingChore) {
        await api(`/api/chores/${editingChore.id}`, { method: 'PUT', body });
      } else {
        await api('/api/chores', { method: 'POST', body });
      }
      onCreated();
      onClose();
    } catch (err) {
      setFormError(err.message || 'The quest scroll could not be saved.');
    } finally {
      setSubmitting(false);
    }
  };

  // Group templates by category
  const templatesByCategory = templates.reduce((acc, tpl) => {
    const cat = tpl.category_name || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(tpl);
    return acc;
  }, {});

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingChore ? 'Edit Quest Scroll' : 'New Quest Scroll'}
      actions={[
        { label: 'Cancel', onClick: onClose, className: 'game-btn game-btn-blue' },
        {
          label: submitting ? 'Saving...' : editingChore ? 'Update Quest' : 'Create Quest',
          onClick: handleSubmit,
          className: 'game-btn game-btn-gold',
          disabled: submitting,
        },
      ]}
    >
      <div className="space-y-4">
        {formError && (
          <div className="p-2 rounded border border-crimson/40 bg-crimson/10 text-crimson text-sm">
            {formError}
          </div>
        )}

        {/* Template picker (only when creating) */}
        {!editingChore && (
          <div>
            <button
              type="button"
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-2 text-accent text-sm hover:text-accent/80 transition-colors"
            >
              <BookTemplate size={14} />
              {showTemplates ? 'Hide templates' : 'Choose from Quest Templates'}
            </button>

            {showTemplates && (
              <div className="mt-3 max-h-60 overflow-y-auto space-y-3 border border-border rounded-lg p-3 bg-surface-raised/30">
                {Object.entries(templatesByCategory).map(([cat, tpls]) => (
                  <div key={cat}>
                    <p className="text-muted text-xs font-bold mb-1">
                      {cat}
                    </p>
                    <div className="space-y-1">
                      {tpls.map((tpl) => {
                        const inUse = existingTitles.has(tpl.title.toLowerCase());
                        return (
                          <button
                            key={tpl.id}
                            onClick={() => applyTemplate(tpl)}
                            className={`w-full text-left px-3 py-2 rounded-lg transition-colors border ${
                              inUse
                                ? 'border-emerald/30 bg-emerald/5 hover:bg-emerald/10'
                                : 'border-transparent hover:bg-surface-raised hover:border-accent/30'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-sm font-medium ${inUse ? 'text-cream/70' : 'text-cream'}`}>
                                {themedTitle(tpl.title, colorTheme)}
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                {inUse && (
                                  <span className="flex items-center gap-1 text-emerald text-xs font-medium">
                                    <CheckCircle2 size={11} />
                                    Created
                                  </span>
                                )}
                                <span className="flex items-center gap-1 text-gold text-xs">
                                  <Star size={10} className="fill-gold" />
                                  {tpl.suggested_points} XP
                                </span>
                              </div>
                            </div>
                            {tpl.description && (
                              <p className={`text-xs line-clamp-1 mt-0.5 ${inUse ? 'text-muted/60' : 'text-muted'}`}>
                                {themedDescription(tpl.title, tpl.description, colorTheme)}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {templates.length === 0 && (
                  <p className="text-muted text-xs text-center py-3">
                    No templates available yet.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Title */}
        <div>
          <label className="block text-cream text-sm font-medium mb-1 tracking-wide">
            Quest Name
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => updateForm('title', e.target.value)}
            placeholder="Defeat the Dust Bunnies"
            className="field-input"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-cream text-sm font-medium mb-1 tracking-wide">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={(e) => updateForm('description', e.target.value)}
            placeholder="Describe the quest details..."
            rows={3}
            className="field-input resize-none"
          />
        </div>

        {/* Points & Difficulty */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-cream text-sm font-medium mb-1 tracking-wide">
              XP Reward
            </label>
            <input
              type="number"
              min={1}
              value={form.points}
              onChange={(e) => updateForm('points', e.target.value)}
              className="field-input"
            />
          </div>
          <div>
            <label className="block text-cream text-sm font-medium mb-1 tracking-wide">
              Difficulty
            </label>
            <select
              value={form.difficulty}
              onChange={(e) => updateForm('difficulty', e.target.value)}
              className={`${selectClass} w-full p-3`}
            >
              {DIFFICULTY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="block text-cream text-sm font-medium mb-1 tracking-wide">
            Category
          </label>
          <select
            value={form.category_id}
            onChange={(e) => updateForm('category_id', e.target.value)}
            className={`${selectClass} w-full p-3`}
          >
            <option value="">Select category...</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Critical toggle */}
        <button
          type="button"
          onClick={() => updateForm('is_critical', !form.is_critical)}
          className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
            form.is_critical
              ? 'border-orange-400/60 bg-orange-400/10'
              : 'border-border bg-surface-raised/30 hover:border-border/80'
          }`}
        >
          <ShieldAlert
            size={18}
            className={form.is_critical ? 'text-orange-400 flex-shrink-0' : 'text-muted flex-shrink-0'}
          />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${form.is_critical ? 'text-orange-300' : 'text-cream'}`}>
              Critical — must be covered during vacations
            </p>
            <p className="text-xs text-muted mt-0.5">
              When the assigned kid is away, this chore enters the open pool for the whole family.
            </p>
          </div>
          <div
            className={`w-9 h-5 rounded-full flex-shrink-0 relative transition-colors ${
              form.is_critical ? 'bg-orange-400' : 'bg-surface-raised border border-border'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                form.is_critical ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </div>
        </button>
      </div>
    </Modal>
  );
}
