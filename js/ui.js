// Petits outils d'interface.

/** Crée un élément : h('div', { class: 'x', onclick: fn }, 'texte', enfant, ...) */
export function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false) continue;
    el.append(e instanceof Node ? e : document.createTextNode(String(e)));
  }
  return el;
}

export function vider(el) { while (el.firstChild) el.firstChild.remove(); return el; }

let toastMinuterie;
export function toast(message, type = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast' }); document.body.append(el); }
  el.textContent = message;
  el.className = 'visible ' + type;
  clearTimeout(toastMinuterie);
  toastMinuterie = setTimeout(() => { el.className = ''; }, 2600);
}

/** Feuille modale (s'ouvre par le bas). Retourne { fermer, corps }. */
export function feuille(titre, construire, { surFermer } = {}) {
  const fond = h('div', { class: 'fond-modal' });
  const corps = h('div', { class: 'feuille-corps' });
  const panneau = h('div', { class: 'feuille', role: 'dialog', 'aria-label': titre },
    h('div', { class: 'feuille-tete' },
      h('h2', {}, titre),
      h('button', { class: 'btn-icone', 'aria-label': 'Fermer', onclick: () => fermer() }, '✕')),
    corps);
  fond.append(panneau);
  fond.addEventListener('click', e => { if (e.target === fond) fermer(); });
  function fermer(val) {
    fond.classList.remove('ouvert');
    setTimeout(() => fond.remove(), 200);
    surFermer && surFermer(val);
  }
  document.body.append(fond);
  requestAnimationFrame(() => fond.classList.add('ouvert'));
  construire(corps, fermer);
  return { fermer, corps };
}

export function confirmer(message, { oui = 'Oui', non = 'Annuler', danger = false } = {}) {
  return new Promise(resolve => {
    feuille('Confirmation', (corps, fermer) => {
      corps.append(
        h('p', { class: 'message-confirm' }, message),
        h('div', { class: 'rangee-boutons' },
          h('button', { class: 'btn secondaire', onclick: () => fermer(false) }, non),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primaire'), onclick: () => fermer(true) }, oui)));
    }, { surFermer: v => resolve(!!v) });
  });
}

export function champ(etiquette, controle, aide) {
  return h('label', { class: 'champ' }, h('span', { class: 'etiquette' }, etiquette), controle,
    aide ? h('small', { class: 'aide' }, aide) : null);
}

/** Convertit « 12,34 » / « 12.34 $ » en nombre. */
export function lireMontant(txt) {
  const n = Number(String(txt || '').replace(/\s|\$/g, '').replace(',', '.'));
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

export function champMontant(valeur, attrs = {}) {
  return h('input', {
    type: 'text', inputmode: 'decimal', class: 'montant', placeholder: '0,00',
    value: valeur === null || valeur === undefined || valeur === '' ? '' : String(valeur).replace('.', ','), ...attrs
  });
}
