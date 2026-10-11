/** Keeps half-typed form values across a page reload (used when the language is switched). */
const KEY = "kb_form_stash";
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function fields(): Field[] {
  return Array.from(document.querySelectorAll<Field>("input, textarea, select")).filter(
    (el) => !(el instanceof HTMLInputElement && ["password", "file", "hidden", "submit", "button"].includes(el.type)),
  );
}

export function stashForms() {
  try {
    const values = fields().map((el) => {
      const checkable = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
      return { v: checkable ? "" : el.value, c: checkable ? (el as HTMLInputElement).checked : false };
    });
    const dirty = values.some((x) => x.v !== "" || x.c); // React mirrors values into defaultValue, so compare with empty instead
    if (dirty) sessionStorage.setItem(KEY, JSON.stringify({ path: location.pathname, at: Date.now(), values }));
  } catch { /* storage unavailable: nothing to keep */ }
}

function setValue(el: Field, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

export function restoreForms() {
  let saved: { path: string; at: number; values: { v: string; c: boolean }[] } | null = null;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || "null"); sessionStorage.removeItem(KEY); } catch { return; }
  if (!saved || saved.path !== location.pathname || Date.now() - saved.at > 20000) return;
  const s = saved;
  const apply = () => {
    const els = fields();
    if (els.length !== s.values.length) return false;
    els.forEach((el, i) => {
      const x = s.values[i];
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) { if (el.checked !== x.c) el.click(); }
      else if (el.value !== x.v) setValue(el, x.v);
    });
    return true;
  };
  let tries = 0;
  const t = setInterval(() => { if (apply() || ++tries > 20) clearInterval(t); }, 150);
}
