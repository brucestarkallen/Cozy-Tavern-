/* Cozy Tavern — engine/voicepresets.js (M510-35)
 * THE STORYTELLER'S VOICE, SAVED — his word: "add saved settings for the frame, the notes and the words in the
 * storyteller's voice, so I can quickly change between saved presets — Hulk, Batman, Iron Man…". A preset is everything
 * that makes the teller who he is, taken together: who is telling and his own name, the grounding phrase, how the teller
 * thinks (I / you), the frame and the note for every story, and his own words. Using one writes them all back exactly —
 * a part the preset kept empty is cleared, so the starter words come back where he had none. The switches (send the
 * frame, the note, to a small model…) and a story's own frame or note are not a voice: they stay as they are.
 *   VOICE_FIELDS                the settings a preset holds
 *   readVoice()                 the voice as it stands in the store
 *   sameVoice(a, b)             two voices alike, part for part
 *   listPresets() / savePreset(name, voice, {id}) / usePreset(id) / removePreset(id) / renamePreset(id, name) */
import { db } from '../store.js';

export const PRESETS_KEY = 'voicePresets';
export const PRESET_ACTIVE_KEY = 'voicePresetActive';
export const VOICE_FIELDS = ['tellerName', 'writerName', 'groundingPhrase', 'tellerPerson', 'frameText', 'noteText', 'ownWords', 'noteAdds']; /* M620: the notes above the note */

const norm = (v) => (v === undefined || v === '' ? null : v);

export async function readVoice() {
  const out = {};
  for (const k of VOICE_FIELDS) out[k] = norm(await db.settings.get(k));
  return out;
}

export function sameVoice(a, b) {
  if (!a || !b) return false;
  return VOICE_FIELDS.every((k) => JSON.stringify(norm(a[k]) ?? null) === JSON.stringify(norm(b[k]) ?? null));
}

export async function listPresets() {
  const kept = await db.settings.get(PRESETS_KEY);
  return (Array.isArray(kept) ? kept : []).filter((p) => p && typeof p === 'object' && p.id && typeof p.name === 'string');
}

const newId = () => 'vp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

/* a new preset, or the one named by id written over; a name he already used is that preset, written over */
export async function savePreset(name, voice, { id = null } = {}) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!clean && !id) return null;
  const all = await listPresets();
  const at = id ? all.findIndex((p) => p.id === id) : all.findIndex((p) => p.name.toLowerCase() === clean.toLowerCase());
  /* M593 (the audit): kept under an id that is gone (deleted in another tab) with no name given — nothing to name it by; it
   * read all[-1].name and threw */
  if (at === -1 && !clean) return null;
  const values = {};
  for (const k of VOICE_FIELDS) values[k] = norm(voice ? voice[k] : null);
  const preset = { id: at >= 0 ? all[at].id : newId(), name: at >= 0 && !clean ? all[at].name : (clean || all[at].name), voice: values, savedAt: Date.now() };
  if (at >= 0) all[at] = preset; else all.push(preset);
  await db.settings.set(PRESETS_KEY, all);
  await db.settings.set(PRESET_ACTIVE_KEY, preset.id);
  return preset;
}

/* every part written back exactly — a part the preset kept empty is cleared */
export async function usePreset(id) {
  const preset = (await listPresets()).find((p) => p.id === id);
  if (!preset) return null;
  for (const k of VOICE_FIELDS) {
    const v = preset.voice ? preset.voice[k] : null;
    if (v === null || v === undefined) await db.settings.delete(k); else await db.settings.set(k, v);
  }
  await db.settings.set(PRESET_ACTIVE_KEY, preset.id);
  return preset;
}

export async function removePreset(id) {
  const all = await listPresets();
  const left = all.filter((p) => p.id !== id);
  if (left.length === all.length) return false;
  await db.settings.set(PRESETS_KEY, left);
  if ((await db.settings.get(PRESET_ACTIVE_KEY)) === id) await db.settings.delete(PRESET_ACTIVE_KEY);
  return true;
}

/* M510-36: a new name for a preset — never empty, never the name of another */
export async function renamePreset(id, name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!clean) return { error: 'a preset needs a name' };
  const all = await listPresets();
  const at = all.findIndex((p) => p.id === id);
  if (at === -1) return { error: 'that preset is gone' };
  if (all.some((p) => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) return { error: 'another preset is already called “' + clean + '”' };
  all[at] = { ...all[at], name: clean };
  await db.settings.set(PRESETS_KEY, all);
  return { preset: all[at] };
}
