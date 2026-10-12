"use client";

import { useEffect, useMemo, useState } from "react";
import { Globe2, CheckCircle2, AlertTriangle, MapPin } from "lucide-react";
import { API_BASE_URL } from "@/config";
import {
  detectTimeZone, getTimeZones, isValidTimeZone, gmtLabel, zonedWallToUtc, formatInZone,
} from "@/lib/timezone";

interface Props {
  value: string;
  onChange: (tz: string) => void;
  /** wall-clock "YYYY-MM-DDTHH:mm" being scheduled in `value` — enables the live "= your local time" preview */
  localTime?: string;
  label?: string;
  className?: string;
}

/**
 * Timezone field with automatic detection.
 *  - Detects the device timezone and asks the user to CONFIRM it before it is used for scheduling.
 *  - Confirmation is saved to the profile (PUT /me/timezone) so it is only asked once.
 *  - If the device zone differs from the saved profile zone (e.g. travelling) it asks which to use.
 *  - Live preview shows how the chosen wall-clock time reads in the viewer's own zone.
 */
export default function TimezonePicker({ value, onChange, localTime, label = "Timezone", className = "" }: Props) {
  const detected = useMemo(() => detectTimeZone(), []);
  const zones = useMemo(() => getTimeZones(), []);
  const [saved, setSaved] = useState<string | null | undefined>(undefined); // undefined = still loading
  const [confirmed, setConfirmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE_URL}/me/timezone`)
      .then(r => (r.ok ? r.json() : { timezone: null }))
      .then(d => {
        if (!alive) return;
        const tz = d?.timezone && isValidTimeZone(d.timezone) ? d.timezone : null;
        setSaved(tz);
        if (tz && tz === detected) { setConfirmed(true); onChange(tz); }
        else if (tz && !value) onChange(tz);
      })
      .catch(() => alive && setSaved(null));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (tz: string) => {
    setSaving(true);
    try {
      await fetch(`${API_BASE_URL}/me/timezone`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: tz }),
      });
      setSaved(tz);
    } catch { /* non-blocking: scheduling still works with the chosen zone */ }
    setSaving(false);
  };

  const confirm = async (tz: string) => {
    onChange(tz);
    setConfirmed(true);
    setEditing(false);
    await persist(tz);
  };

  const invalid = !!value && !isValidTimeZone(value);
  const mismatch = saved !== undefined && saved !== null && saved !== detected;
  const needsConfirm = saved !== undefined && !confirmed && !invalid;

  // viewer-zone preview of the time being scheduled
  const preview = useMemo(() => {
    if (!localTime || !value || invalid) return null;
    const utc = zonedWallToUtc(localTime, value);
    if (!utc) return null;
    const viewerZone = detected;
    return {
      theirs: formatInZone(utc, value),
      yours: formatInZone(utc, viewerZone),
      utc: formatInZone(utc, "UTC", { hour: "numeric", minute: "2-digit" }),
      same: value === viewerZone,
    };
  }, [localTime, value, invalid, detected]);

  const inputCls = "w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border text-sm text-slate-800 dark:text-zinc-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className={className}>
      <label className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-widest mb-1 flex items-center gap-1.5">
        <Globe2 className="w-3.5 h-3.5" /> {label}
      </label>

      {/* Auto-detect confirmation */}
      {needsConfirm && !editing && (
        <div className="mb-2 rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 p-3">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 mt-0.5 text-violet-600 shrink-0" />
            <div className="min-w-0 flex-1 text-xs text-slate-700 dark:text-zinc-200">
              {mismatch ? (
                <>
                  <p className="font-bold">Your device is in <span className="text-violet-600">{detected}</span>, but your profile uses <span className="text-violet-600">{saved}</span>.</p>
                  <p className="text-slate-500 dark:text-zinc-400 mt-0.5">Which timezone should this meeting use?</p>
                </>
              ) : (
                <>
                  <p className="font-bold">We detected your timezone: <span className="text-violet-600">{detected}</span> <span className="font-normal text-slate-500">({gmtLabel(detected)})</span></p>
                  <p className="text-slate-500 dark:text-zinc-400 mt-0.5">Local time there now: {formatInZone(new Date(), detected, { weekday: undefined })}. Is this correct?</p>
                </>
              )}
              <div className="flex flex-wrap gap-2 mt-2.5">
                <button type="button" onClick={() => confirm(detected)} disabled={saving}
                  className="px-3 py-2 min-h-[40px] rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {mismatch ? `Use ${detected}` : "Yes, use this"}
                </button>
                {mismatch && saved && (
                  <button type="button" onClick={() => confirm(saved)} disabled={saving}
                    className="px-3 py-2 min-h-[40px] rounded-lg bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200">
                    Keep {saved}
                  </button>
                )}
                <button type="button" onClick={() => setEditing(true)}
                  className="px-3 py-2 min-h-[40px] rounded-lg bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200">
                  Choose another
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selector (always available; emphasised when editing) */}
      <input
        list="tz-options" value={value} onChange={e => { onChange(e.target.value); }}
        onBlur={() => { if (value && isValidTimeZone(value) && value !== saved && editing) confirm(value); }}
        placeholder="Start typing — e.g. Asia/Kolkata"
        className={`${inputCls} ${invalid ? "border-red-400" : "border-slate-200 dark:border-zinc-700"}`}
        autoComplete="off" spellCheck={false}
      />
      <datalist id="tz-options">{zones.map(z => <option key={z} value={z} />)}</datalist>

      {invalid && (
        <p className="mt-1 text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Unknown timezone — pick one from the list.</p>
      )}
      {!invalid && value && confirmed && (
        <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" /> {value} · {gmtLabel(value)} confirmed
          {value !== detected && <button type="button" className="underline ml-1 text-slate-500" onClick={() => confirm(detected)}>use device zone ({detected})</button>}
        </p>
      )}

      {preview && !preview.same && (
        <div className="mt-2 rounded-lg bg-slate-100 dark:bg-zinc-800/70 px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-zinc-300">
          <p><b>{preview.theirs}</b> in {value}</p>
          <p>= <b>{preview.yours}</b> your time ({detected}) · {preview.utc} UTC</p>
        </div>
      )}
    </div>
  );
}
