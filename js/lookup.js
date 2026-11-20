// Traduction, définitions et étymologies (Wiktionnaire), lecture à voix haute,
// explications par Claude (clé API personnelle, facultative).
// Seul le texte sélectionné est envoyé au service choisi, à la demande.
import { el, icon, btn, toast } from './ui.js';
import { getSettings, setSetting } from './store.js';

export const LANGS = [
  ['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'], ['de', 'Allemand'], ['it', 'Italien'],
  ['pt', 'Portugais'], ['nl', 'Néerlandais'], ['la', 'Latin'], ['el', 'Grec'], ['ar', 'Arabe'],
  ['zh-CN', 'Chinois'], ['ja', 'Japonais'], ['ru', 'Russe'], ['pl', 'Polonais'], ['tr', 'Turc'],
];

// --- Panneau latéral ------------------------------------------------------------
function panel(view, title, iconName) {
  const p = view.rpanel;
  p.innerHTML = '';
  p.classList.add('open');
  const body = el('div', { class: 'rp-body' });
  p.append(el('div', { class: 'rp-head' }, icon(iconName, 18), el('h3', {}, title), el('div', { class: 'grow' }),
    btn('close', 'Fermer', () => { p.classList.remove('open'); p.innerHTML = ''; window.speechSynthesis?.cancel(); })), body);
  return body;
}
const loading = (b, msg = 'Recherche…') => { b.innerHTML = ''; b.append(el('div', { class: 'rp-loading' }, el('div', { class: 'spinner' }), msg)); };

// --- Traduction -------------------------------------------------------------------
async function translateGoogle(text, to) {
  const out = [];
  for (const chunk of chunks(text, 1800)) {
    const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' + encodeURIComponent(to) + '&q=' + encodeURIComponent(chunk));
    if (!r.ok) throw new Error('Service de traduction indisponible');
    const j = await r.json();
    out.push(j[0].map(x => x[0]).join(''));
    var detected = j[2];
  }
  return { text: out.join(' '), from: detected };
}
async function translateMyMemory(text, to) {
  const out = [];
  for (const chunk of chunks(text, 480)) {
    const r = await fetch('https://api.mymemory.translated.net/get?langpair=' + encodeURIComponent('autodetect|' + to) + '&q=' + encodeURIComponent(chunk));
    const j = await r.json();
    out.push(j.responseData?.translatedText || '');
  }
  return { text: out.join(' ') };
}
function chunks(text, n) {
  const parts = []; let cur = '';
  for (const s of text.split(/(?<=[.!?;:])\s+/)) {
    if ((cur + ' ' + s).length > n && cur) { parts.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
  }
  if (cur) parts.push(cur);
  return parts.flatMap(p => p.length > n ? p.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) : [p]);
}

// --- Claude (SDK officiel chargé à la demande) --------------------------------------
let sdkP;
async function claudeClient() {
  const key = getSettings().claudeKey;
  if (!key) return null;
  sdkP ??= import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.5.0/+esm');
  const { default: Anthropic } = await sdkP;
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

async function askClaude(system, user, onText) {
  const client = await claudeClient();
  if (!client) throw Object.assign(new Error('nokey'), { nokey: true });
  const stream = client.beta.messages.stream({
    model: getSettings().claudeModel || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
  });
  let acc = '';
  stream.on('text', (t) => { acc += t; onText?.(acc); });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude a refusé de répondre à cette demande.');
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function noKeyBox(b) {
  b.append(el('div', { class: 'card-soft' },
    el('p', {}, 'Cette fonction utilise Claude avec votre propre clé API Anthropic (facturée par Anthropic, à l\'usage).'),
    el('p', { class: 'muted small' }, 'La clé reste enregistrée sur cet appareil. Seul le texte que vous sélectionnez est envoyé.'),
    el('button', { class: 'btn primary small', onclick: () => document.dispatchEvent(new CustomEvent('folio:settings', { detail: 'ia' })) }, 'Ajouter ma clé dans les réglages')));
}

// Mise en forme minimale du Markdown renvoyé par l'IA.
function md(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc(text)
    .replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h4>$1</h4>').replace(/^# (.*)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/^\s*[-•] (.*)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, (m) => '<ul>' + m + '</ul>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}

// --- Wiktionnaire --------------------------------------------------------------------
async function wiktionary(word, lang) {
  const tryOne = async (w) => {
    const r = await fetch(`https://${lang}.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=` + encodeURIComponent(w));
    const j = await r.json();
    const page = Object.values(j.query?.pages || {})[0];
    return page && !('missing' in page) ? page : null;
  };
  return (await tryOne(word)) || (word !== word.toLowerCase() ? await tryOne(word.toLowerCase()) : null);
}

function parseWiktionary(extract, lang) {
  // Sections « == Langue == » puis « === Rubrique === ».
  const langName = lang === 'fr' ? 'Français' : 'English';
  const blocks = extract.split(/\n== /);
  let block = blocks.find(b => b.startsWith(langName + ' ==')) || blocks[1] || blocks[0];
  const out = { etym: '', etyms: [], senses: [], synonyms: [] };
  const secs = block.split(/\n=== /).slice(1);
  for (const s of secs) {
    const [head, ...rest] = s.split('\n');
    const title = head.replace(/=+\s*$/, '').trim();
    // On s'arrête aux sous-rubriques (« ==== Dérivés ==== », traductions…).
    const stop = rest.findIndex(l => l.trim().startsWith('=='));
    const lines = (stop >= 0 ? rest.slice(0, stop) : rest).map(l => l.trim()).filter(Boolean)
      .filter(l => !/figure dans les recueils|^\(Date à préciser\)$/.test(l));
    if (/^(Étymologie|Etymology)/i.test(title)) {
      // Plusieurs étymologies possibles (homonymes : « Etymology 1 », « Etymology 2 »…).
      if (lines.length) out.etyms.push(lines.join(' '));
      out.etym = out.etyms.join(' ');
    }
    else if (/^(Nom|Verbe|Adjectif|Adverbe|Pronom|Préposition|Conjonction|Interjection|Locution|Noun|Verb|Adjective|Adverb|Pronoun|Préfixe|Suffixe)/i.test(title)) {
      const [pron, ...defs] = lines;
      const items = defs.filter(l => !/ — \(/.test(l) && l.length < 600).slice(0, 8);
      out.senses.push({ title, pron, items });
    } else if (/^(Synonymes|Synonyms)/i.test(title)) out.synonyms = lines.slice(0, 12);
  }
  return out;
}

// --- API publique ----------------------------------------------------------------------
export const lookup = {
  async translate(view, text) {
    view.hideSelPop?.();
    const b = panel(view, 'Traduction', 'translate');
    const s = getSettings();
    const to = el('select', { class: 'input', onchange: () => { setSetting('translateTo', to.value); run(); } },
      LANGS.map(([v, l]) => { const o = el('option', {}, l); o.value = v; o.selected = v === s.translateTo; return o; }));
    const eng = el('select', { class: 'input', onchange: () => { setSetting('translateEngine', eng.value); run(); } },
      [['google', 'Google Traduction'], ['mymemory', 'MyMemory'], ['claude', 'Claude (IA)']].map(([v, l]) => { const o = el('option', {}, l); o.value = v; o.selected = v === s.translateEngine; return o; }));
    const res = el('div', { class: 'rp-result' });
    const orig = el('details', { class: 'rp-orig' }, el('summary', {}, 'Texte d\'origine'), el('p', {}, text));
    b.append(el('div', { class: 'grid2' }, to, eng), res, orig);
    const run = async () => {
      loading(res, 'Traduction…');
      try {
        let r;
        if (eng.value === 'claude') {
          const target = LANGS.find(l => l[0] === to.value)?.[1] || to.value;
          const p = el('p', { class: 'rp-text' });
          res.innerHTML = ''; res.append(p);
          r = { text: await askClaude('Tu es un traducteur. Traduis fidèlement le texte fourni, en conservant le sens et le registre. Réponds uniquement par la traduction.', `Traduis en ${target} :\n\n${text}`, (t) => (p.textContent = t)) };
        } else r = await (eng.value === 'mymemory' ? translateMyMemory : translateGoogle)(text, to.value);
        res.innerHTML = '';
        res.append(el('p', { class: 'rp-text' }, r.text),
          el('div', { class: 'row' },
            el('button', { class: 'btn small', onclick: () => { navigator.clipboard.writeText(r.text); toast('Traduction copiée'); } }, icon('copy', 16), ' Copier'),
            el('button', { class: 'btn small', onclick: () => lookup.speak(r.text, to.value) }, icon('speak', 16), ' Écouter'),
            el('button', { class: 'btn small', onclick: () => view.annotator.addTranslationNote?.(text, r.text) }, icon('note', 16), ' En note')));
        if (r.from) res.append(el('p', { class: 'muted small' }, 'Langue détectée : ' + (LANGS.find(l => l[0] === r.from)?.[1] || r.from)));
      } catch (e) {
        res.innerHTML = '';
        if (e.nokey) noKeyBox(res); else res.append(el('p', { class: 'error' }, 'Traduction impossible : ' + e.message + '. Vérifiez la connexion internet ou changez de service.'));
      }
    };
    run();
  },

  async translatePage(view) {
    const t = await view.pageText(view.current);
    if (!t.trim()) { toast('Aucun texte sur cette page (scan ? essayez l\'OCR).', 'error', 5000); return; }
    this.translate(view, t.trim());
  },

  async define(view, raw) {
    view.hideSelPop?.();
    const word = raw.trim().split(/\s+/).slice(0, 4).join(' ').replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, '');
    const b = panel(view, 'Dictionnaire', 'book');
    const s = getSettings();
    const lang = el('select', { class: 'input', onchange: () => { setSetting('dictLang', lang.value); run(); } },
      [['fr', 'Wiktionnaire français'], ['en', 'Wiktionary (anglais)']].map(([v, l]) => { const o = el('option', {}, l); o.value = v; o.selected = v === s.dictLang; return o; }));
    const q = el('input', { class: 'input', value: word, onkeydown: (e) => e.key === 'Enter' && run() });
    const res = el('div', { class: 'rp-result' });
    b.append(el('div', { class: 'grid2' }, q, lang), res);
    const run = async () => {
      loading(res);
      try {
        const page = await wiktionary(q.value.trim(), lang.value);
        res.innerHTML = '';
        if (!page) {
          res.append(el('p', {}, `« ${q.value} » n'a pas été trouvé dans le Wiktionnaire.`));
        } else {
          const d = parseWiktionary(page.extract || '', lang.value);
          res.append(el('h2', { class: 'dict-word' }, page.title));
          for (const sense of d.senses) {
            res.append(el('div', { class: 'dict-sense' }, el('h4', {}, sense.title), sense.pron ? el('p', { class: 'muted small' }, sense.pron) : null,
              el('ol', {}, sense.items.map(it => el('li', {}, it)))));
          }
          if (d.etym) res.append(el('div', { class: 'dict-etym' }, el('h4', {}, 'Étymologie'), el('p', {}, d.etym)));
          if (d.synonyms.length) res.append(el('div', {}, el('h4', {}, 'Synonymes'), el('p', {}, d.synonyms.join(' · '))));
          if (!d.senses.length && !d.etym) res.append(el('p', { class: 'rp-text' }, (page.extract || '').slice(0, 1500)));
          res.append(el('p', { class: 'muted small' }, 'Source : ', el('a', { href: `https://${lang.value}.wiktionary.org/wiki/${encodeURIComponent(page.title)}`, target: '_blank', rel: 'noopener' }, 'Wiktionnaire'), ' (CC BY-SA).'));
        }
        res.append(el('button', { class: 'btn small', onclick: () => lookup.explain(view, q.value, 'word') }, icon('sparkle', 16), ' Demander à l\'IA (sens dans ce contexte)'));
        res.append(el('button', { class: 'btn small', onclick: () => lookup.speak(q.value, lang.value) }, icon('speak', 16), ' Prononcer'));
        res.append(el('button', { class: 'btn small', onclick: () => lookup.etymology(view, q.value) }, icon('roots', 16), ' Étymologie'));
      } catch (e) { res.innerHTML = ''; res.append(el('p', { class: 'error' }, 'Recherche impossible (connexion internet requise).')); }
    };
    run();
  },

  async etymology(view, raw) {
    view.hideSelPop?.();
    const word = raw.trim().split(/\s+/).slice(0, 4).join(' ').replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, '');
    const b = panel(view, 'Étymologie', 'roots');
    const s = getSettings();
    const lang = el('select', { class: 'input', onchange: () => { setSetting('dictLang', lang.value); run(); } },
      [['fr', 'Wiktionnaire français'], ['en', 'Wiktionary (anglais)']].map(([v, l]) => { const o = el('option', {}, l); o.value = v; o.selected = v === s.dictLang; return o; }));
    const q = el('input', { class: 'input', value: word, onkeydown: (e) => e.key === 'Enter' && run() });
    const res = el('div', { class: 'rp-result' });
    b.append(el('div', { class: 'grid2' }, q, lang), res);
    const run = async () => {
      loading(res);
      const w = q.value.trim();
      try {
        let l = lang.value, page = await wiktionary(w, l), d = page && parseWiktionary(page.extract || '', l);
        // Rien dans un Wiktionnaire : on essaie l'autre.
        if (!d?.etyms.length) {
          const l2 = l === 'fr' ? 'en' : 'fr';
          const p2 = await wiktionary(w, l2), d2 = p2 && parseWiktionary(p2.extract || '', l2);
          if (d2?.etyms.length) { page = p2; d = d2; l = l2; }
        }
        res.innerHTML = '';
        if (!page) res.append(el('p', {}, `« ${w} » n'a pas été trouvé dans le Wiktionnaire.`));
        else {
          res.append(el('h2', { class: 'dict-word' }, page.title));
          if (d.etyms.length) {
            d.etyms.forEach((t, i) => res.append(el('div', { class: 'dict-etym' },
              d.etyms.length > 1 ? el('h4', {}, `Origine ${i + 1}`) : null, el('p', {}, t))));
          } else res.append(el('p', { class: 'muted' }, 'Le Wiktionnaire ne donne pas d\'étymologie pour ce mot.'));
          res.append(el('p', { class: 'muted small' }, 'Source : ', el('a', { href: `https://${l}.wiktionary.org/wiki/${encodeURIComponent(page.title)}`, target: '_blank', rel: 'noopener' }, l === 'fr' ? 'Wiktionnaire' : 'Wiktionary'), ' (CC BY-SA).'));
        }
      } catch (e) { res.innerHTML = ''; res.append(el('p', { class: 'error' }, 'Recherche impossible (connexion internet requise).')); }
      // Pour aller plus loin : dictionnaires étymologiques de référence et IA.
      const enc = encodeURIComponent(w.toLowerCase());
      res.append(el('div', { class: 'row wrap' },
        el('a', { class: 'btn small', href: `https://www.cnrtl.fr/etymologie/${enc}`, target: '_blank', rel: 'noopener' }, 'CNRTL (français)'),
        el('a', { class: 'btn small', href: `https://www.etymonline.com/word/${enc}`, target: '_blank', rel: 'noopener' }, 'Etymonline (anglais)')));
      res.append(el('button', { class: 'btn small', onclick: () => lookup.explain(view, w, 'etym') }, icon('sparkle', 16), ' Étymologie détaillée (IA)'));
    };
    run();
  },

  speak(text, lang) {
    const synth = window.speechSynthesis;
    if (!synth) { toast('La lecture à voix haute n\'est pas disponible ici.', 'error'); return; }
    if (synth.speaking) { synth.cancel(); return; }
    const u = new SpeechSynthesisUtterance(text);
    const l = lang || (/[àâçéèêëîïôûùüÿœ]/i.test(text) || getSettings().dictLang === 'fr' ? 'fr-FR' : 'en-US');
    u.lang = l;
    const voice = synth.getVoices().find(v => v.lang.startsWith(l.slice(0, 2)) && /natural|online|neural/i.test(v.name)) || synth.getVoices().find(v => v.lang.startsWith(l.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 1;
    synth.speak(u);
    toast('Lecture… (cliquez à nouveau sur « Lire » pour arrêter)', 'info', 2200);
  },

  async readPage(view) {
    const t = await view.pageText(view.current);
    if (!t.trim()) { toast('Aucun texte lisible sur cette page.', 'error'); return; }
    this.speak(t);
  },

  async explain(view, text, mode = 'explain') {
    view.hideSelPop?.();
    const titles = { explain: 'Expliquer', word: 'Sens du mot', etym: 'Étymologie (IA)',summary: 'Résumé de la page', quiz: 'Questions de révision' };
    const b = panel(view, titles[mode] || 'IA', 'sparkle');
    const res = el('div', { class: 'rp-result rp-ai' });
    b.append(res);
    if (!getSettings().claudeKey) { noKeyBox(res); return; }
    loading(res, 'Claude réfléchit…');
    const ctx = (await view.pageText(view.current)).slice(0, 6000);
    const prompts = {
      explain: [`Tu aides un étudiant francophone à comprendre un document. Explique clairement et simplement le passage demandé, en t'appuyant sur le contexte de la page. Donne les notions clés, un exemple si utile. Réponds en français, de façon concise.`, `Contexte (page ${view.current + 1} du document « ${view.name} ») :\n${ctx}\n\nPassage à expliquer :\n${text}`],
      word: [`Tu es un lexicographe. Donne le sens du mot ou de l'expression dans le contexte fourni, puis son étymologie, en français et en quelques lignes.`, `Contexte :\n${ctx}\n\nMot ou expression : ${text}`],
      etym: [`Tu es un étymologiste. Retrace l'origine du mot ou de l'expression : langue et forme d'origine (latin, grec, francique, arabe…), sens premier, évolution de la forme et du sens jusqu'au sens actuel, avec les dates de première attestation si elles sont connues. Cite quelques mots de la même famille. Signale les hypothèses incertaines. Réponds en français, de façon structurée et concise.`, `Mot ou expression : ${text}\n\nContexte où il apparaît :\n${ctx.slice(0, 1500)}`],
      summary: [`Tu aides un étudiant à réviser. Résume la page fournie en français : les idées principales en puces, puis les termes clés à retenir avec une courte définition.`, `Page ${view.current + 1} du document « ${view.name} » :\n${text}`],
      quiz: [`Tu prépares un étudiant à un examen. À partir du texte fourni, écris 6 questions de révision variées (définitions, compréhension, application), chacune suivie de sa réponse courte. Réponds en français.`, text],
    };
    try {
      const [sys, user] = prompts[mode];
      const out = await askClaude(sys, user, (t) => { res.innerHTML = md(t); });
      res.innerHTML = md(out);
      res.append(el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => { navigator.clipboard.writeText(out); toast('Copié'); } }, icon('copy', 16), ' Copier')));
    } catch (e) {
      res.innerHTML = '';
      res.append(el('p', { class: 'error' }, e.status === 401 ? 'Clé API refusée. Vérifiez-la dans les réglages.' : 'Erreur : ' + (e.message || e)));
    }
  },

  async summarizePage(view) {
    const t = await view.pageText(view.current);
    if (!t.trim()) { toast('Aucun texte sur cette page.', 'error'); return; }
    this.explain(view, t, 'summary');
  },
  async quizPage(view) {
    const t = await view.pageText(view.current);
    if (!t.trim()) { toast('Aucun texte sur cette page.', 'error'); return; }
    this.explain(view, t, 'quiz');
  },
};
