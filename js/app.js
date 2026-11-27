// Point d'entrée : démarrage, verrou, navigation et écrans Accueil / Mouvements / Année (Récurrents et Réglages : reglages.js).
import { h, vider, toast, fermerDerniere } from './ui.js';
import { surChangement, getMeta } from './db.js';
import { E, charger, initialiserSiVide, materialiser, donneesCalc, icone, revenusAConfirmer, reglage } from './etat.js';
import { calculerMois, calculerAnnee, argent, moisCourant, decalerMois, nomMois, nomMoisCourt, finDuMois, aujourdhui, ymd, versDate } from './calc.js';
import { demarrerSyncAuto, surEtatSync, synchroniser } from './sync.js';
import { nipDefini, verifierNip, biometrieActive, biometrieDisponible, deverrouillerBiometrie, activerBiometrie, surveillerArrierePlan } from './lock.js';
import { ouvrirAjout, ecranTransactions, ouvrirConfirmations, ouvrirSaisie, rechercherEntrees, listeEntrees, estFixe } from './saisie.js';
import { ecranReglages, ecranRecurrents, choisirMoi, demanderNouveauNip, configurerSync } from './reglages.js';
import { ouvrirPhoto } from './ocr.js';

const racine = document.getElementById('app');
const vue = { ecran: 'accueil', mois: moisCourant(), filtre: null };
let deverrouille = false;
let confirmationsMontrees = false;

// ------------------------------------------------------------------ démarrage
async function demarrer() {
  installerMisesAJour();
  await initialiserSiVide();
  await charger();
  if (!(await nipDefini())) return accueilPremiereFois();
  await ecranVerrou();
}

// Mises à jour : le téléphone vérifie sw.js sans cache (à l'ouverture et à chaque retour dans l'app).
// Quand une nouvelle version prend le relais, la page se recharge UNE fois (pas si une fenêtre de saisie
// est ouverte : dans ce cas, au prochain passage en arrière-plan), puis affiche « Mise à jour installée ».
function installerMisesAJour() {
  if (!('serviceWorker' in navigator)) return;
  const avaitControleur = !!navigator.serviceWorker.controller; // false = toute première installation
  let rechargement = false;
  const recharger = () => {
    if (rechargement) return;
    rechargement = true;
    try { sessionStorage.setItem('majInstallee', '1'); } catch {}
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitControleur) return;
    if (!document.querySelector('.fond-modal')) return recharger();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') recharger(); });
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
  let maj = null;
  try { maj = sessionStorage.getItem('majInstallee'); sessionStorage.removeItem('majInstallee'); } catch {}
  if (maj) setTimeout(() => toast('Mise à jour installée ✓'), 800);
}

let dejaDemarre = false;
async function apresDeverrouillage() {
  deverrouille = true;
  if (!dejaDemarre) {
    dejaDemarre = true;
    surveillerArrierePlan(() => { deverrouille = false; ecranVerrou(); });
    installerRetour();
    surChangement(async () => { await charger(); await materialiser(); if (deverrouille) dessiner(); });
    await materialiser();
    await charger();
    demarrerSyncAuto();
  } else if (!history.state || history.state.budget !== 'tampon') {
    history.pushState({ budget: 'tampon' }, ''); // réarme le bouton retour après un reverrouillage
  }
  dessiner();
}

async function accueilPremiereFois() {
  vider(racine).append(h('div', { class: 'bienvenue' },
    h('div', { class: 'logo' }, '💰'),
    h('h1', {}, 'Budget'),
    h('p', {}, 'Suivi des dépenses et des revenus, synchronisé avec ton Google Sheets.'),
    h('button', { class: 'btn primaire large', onclick: configurationInitiale }, 'Commencer')));
}

async function configurationInitiale() {
  if (!await choisirMoi(null, true)) return;
  if (!await demanderNouveauNip()) return;
  if (await biometrieDisponible()) {
    try { await activerBiometrie(E.moi); toast('Biométrie activée ✓'); } catch { toast('Biométrie non activée — tu pourras le faire dans Réglages', 'info'); }
  }
  await configurerSync(null);
  await synchroniser();
  await charger();
  if (!E.reglages.debut) await reglage('debut', moisCourant());
  await charger();
  await apresDeverrouillage();
  toast(`Bienvenue ${E.moi} ! Ajoute tes paies et dépenses fixes dans l'onglet Récurrents.`, 'info');
}

// ------------------------------------------------------------------ verrou
async function ecranVerrou() {
  let saisie = '';
  const points = h('div', { class: 'points' });
  const majPoints = () => points.replaceChildren(...Array.from({ length: Math.max(4, saisie.length) }, (_, i) => h('span', { class: i < saisie.length ? 'plein' : '' })));
  majPoints();
  const bio = await biometrieActive();

  async function essayerBio() {
    if (await deverrouillerBiometrie()) apresDeverrouillage();
  }
  async function touche(t) {
    if (t === '⌫') saisie = saisie.slice(0, -1);
    else if (saisie.length < 8) saisie += t;
    majPoints();
    if (saisie.length >= 4 && await verifierNip(saisie)) return apresDeverrouillage();
    if (saisie.length === 8) { saisie = ''; majPoints(); toast('NIP incorrect', 'erreur'); }
  }
  const clavier = h('div', { class: 'clavier' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9', bio ? '👆' : '', '0', '⌫'].map(t =>
      t ? h('button', { class: 'touche', onclick: () => t === '👆' ? essayerBio() : touche(t) }, t) : h('span')));
  vider(racine).append(h('div', { class: 'verrou' },
    h('div', { class: 'logo' }, '🔒'), h('h2', {}, 'Budget'),
    h('p', { class: 'aide' }, bio ? 'Empreinte, visage ou NIP' : 'Entre ton NIP'),
    points, clavier));
  if (bio) setTimeout(essayerBio, 300);
}

// ------------------------------------------------------------------ navigation
// Écrans visités, pour que le bouton « retour » du téléphone revienne en arrière.
const precedents = [];
function aller(ecran, options = {}) {
  if (ecran === 'annee' && !options.mois) options = { ...options, mois: moisCourant() }; // l'onglet Année s'ouvre sur l'année en cours
  if (ecran !== vue.ecran || options.filtre) {
    precedents.push({ ecran: vue.ecran, mois: vue.mois, filtre: vue.filtre });
    if (precedents.length > 30) precedents.shift();
  }
  Object.assign(vue, { ecran, filtre: null, recherche: null }, options); dessiner(); window.scrollTo(0, 0);
}

/**
 * Bouton « retour » d'Android : sans historique, il ferme l'app. On garde donc une page « tampon »
 * dans l'historique du navigateur. Chaque retour est intercepté :
 * 1) ferme la fenêtre ouverte (formulaire, photo…) ; 2) sinon ferme la recherche ;
 * 3) sinon revient à l'écran précédent ; 4) sinon revient à l'Accueil ;
 * 5) sur l'Accueil : « Appuie encore sur retour pour quitter ».
 */
let pretAQuitter = false;
function installerRetour() {
  history.replaceState({ budget: 'base' }, '');
  history.pushState({ budget: 'tampon' }, '');
  window.addEventListener('popstate', () => {
    if (!deverrouille) return; // écran de verrouillage : comportement normal
    if (pretAQuitter) { history.back(); return; } // page plus ancienne (après un rechargement) : on continue de reculer
    if (fermerDerniere()) { /* fenêtre fermée */ }
    else if (vue.recherche) { vue.recherche = null; dessiner(); }
    else if (precedents.length) { Object.assign(vue, precedents.pop(), { recherche: null }); dessiner(); window.scrollTo(0, 0); }
    else if (vue.ecran !== 'accueil') { Object.assign(vue, { ecran: 'accueil', filtre: null, recherche: null }); dessiner(); window.scrollTo(0, 0); }
    else {
      // Accueil : on reste sur la page de base, donc le prochain « retour » ferme l'app.
      pretAQuitter = true;
      toast('Appuie encore sur retour pour quitter', 'info');
      setTimeout(() => { pretAQuitter = false; history.pushState({ budget: 'tampon' }, ''); }, 2500);
      return;
    }
    history.pushState({ budget: 'tampon' }, '');
  });
}

function barreNav() {
  const item = (id, ic, txt) => h('button', { class: 'nav-item' + (vue.ecran === id ? ' actif' : ''), onclick: () => aller(id), 'aria-label': txt },
    h('span', { class: 'nav-ic' }, ic), h('span', {}, txt));
  return h('nav', { class: 'barre-nav' },
    item('accueil', '🏠', 'Accueil'), item('transactions', '📋', 'Mouvements'),
    h('button', { class: 'fab', 'aria-label': 'Ajouter', onclick: () => ouvrirAjout(ouvrirPhoto) }, '＋'),
    item('recurrents', '🔁', 'Récurrents'), item('annee', '📅', 'Année'));
}

// Roue ⚙️ en haut à droite : ouvre les Réglages.
function boutonReglages() {
  return h('button', { class: 'btn-icone roue' + (vue.ecran === 'reglages' ? ' actif' : ''), 'aria-label': 'Réglages', onclick: () => aller('reglages') }, '⚙️');
}

const indicateurSync = h('button', { class: 'sync', onclick: () => synchroniser() });
surEtatSync(etat => {
  const heure = etat.derniere ? new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' }).format(etat.derniere) : null;
  indicateurSync.className = 'sync' + (etat.erreur ? ' erreur' : etat.enAttente ? ' attente' : '');
  indicateurSync.textContent = etat.enCours ? '↻ Synchro…'
    : etat.erreur ? '⚠ ' + etat.erreur
    : etat.enAttente ? `${etat.enAttente} en attente${heure ? ' · ' + heure : ''}`
    : heure ? `✓ Synchro ${heure}` : (navigator.onLine ? '—' : 'Hors ligne');
});

function selecteurMois() {
  return h('div', { class: 'selecteur-mois' },
    h('button', { class: 'btn-icone', 'aria-label': 'Mois précédent', onclick: () => { vue.mois = decalerMois(vue.mois, -1); dessiner(); } }, '‹'),
    // Toucher le nom du mois ramène au mois actuel. Sur un autre mois : nom en couleur + ↩ pour le signaler.
    vue.mois === moisCourant()
      ? h('button', { class: 'mois-titre' }, nomMois(vue.mois))
      : h('button', { class: 'mois-titre autre', 'aria-label': `${nomMois(vue.mois)} — toucher pour revenir au mois actuel`,
          onclick: () => { vue.mois = moisCourant(); dessiner(); } }, nomMois(vue.mois), h('span', { class: 'retour-mois' }, ' ↩')),
    h('button', { class: 'btn-icone', 'aria-label': 'Mois suivant', onclick: () => { vue.mois = decalerMois(vue.mois, 1); dessiner(); } }, '›'));
}

let dessinEnCours = false;
async function dessiner() {
  if (dessinEnCours) return;
  dessinEnCours = true;
  try {
    let contenu;
    if (vue.ecran === 'accueil') contenu = ecranAccueil();
    else if (vue.ecran === 'transactions') contenu = ecranEntrees();
    else if (vue.ecran === 'annee') contenu = ecranAnnee();
    else if (vue.ecran === 'recurrents') contenu = ecranRecurrents(dessiner);
    else contenu = await ecranReglages(dessiner);

    // Garder le curseur dans la zone de recherche si une synchro redessine l'écran pendant la frappe.
    const actif = document.activeElement && document.activeElement.id === 'recherche-texte'
      ? { debut: document.activeElement.selectionStart, fin: document.activeElement.selectionEnd } : null;
    vider(racine).append(
      h('header', { class: 'entete' }, h('h1', {}, { accueil: 'Budget', transactions: 'Mouvements', recurrents: 'Récurrents', annee: 'Année', reglages: 'Réglages' }[vue.ecran]),
        h('div', { class: 'entete-droite' }, indicateurSync, boutonReglages())),
      h('main', { class: 'contenu' }, contenu),
      barreNav());
    if (actif) {
      const champ = document.getElementById('recherche-texte');
      if (champ) { champ.focus(); champ.setSelectionRange(actif.debut, actif.fin); }
    }

    if (!confirmationsMontrees && revenusAConfirmer().length) { confirmationsMontrees = true; setTimeout(ouvrirConfirmations, 400); }
  } finally { dessinEnCours = false; }
}

// ------------------------------------------------------------------ Accueil
function ecranAccueil() {
  const d = donneesCalc();
  const m = calculerMois(d, vue.mois);
  const aConfirmer = revenusAConfirmer();
  const pct = m.revenus > 0 ? Math.min(100, Math.round(m.depenses / m.revenus * 100)) : (m.depenses > 0 ? 100 : 0);
  const signe = v => v >= 0 ? 'positif' : 'negatif';
  const moisActuel = vue.mois === moisCourant() && vue.mois >= E.debut;

  // Budget par jour : restant ÷ jours qui restent (aujourd'hui compris), mois en cours seulement.
  let parJour = null;
  if (moisActuel && m.restant > 0) {
    const fin = finDuMois(vue.mois);
    const jours = fin.getDate() - new Date().getDate() + 1;
    parJour = h('div', { class: 'ligne-parjour' },
      `💡 Environ ${argent(m.restant / jours)}/jour jusqu'au ${fin.getDate()} ${nomMoisCourt(vue.mois)}`,
      m.epicerie.aVenir > 0 ? h('small', {}, ' (épicerie à venir déjà comptée)') : null);
  }

  return h('div', {},
    selecteurMois(),
    aConfirmer.length ? h('button', { class: 'bandeau', onclick: ouvrirConfirmations },
      `💵 ${aConfirmer.length} revenu${aConfirmer.length > 1 ? 's' : ''} à confirmer`, h('span', {}, '›')) : null,
    vue.mois < E.debut ? h('p', { class: 'aide centre' }, `Le suivi commence en ${nomMois(E.debut)}.`) : null,

    h('section', { class: 'carte resume ' + signe(m.restant) },
      h('small', {}, 'Restant ce mois'),
      h('div', { class: 'gros-montant' }, argent(m.restant)),
      h('div', { class: 'barre' }, h('span', { style: { width: pct + '%' } })),
      h('div', { class: 'deux-col' },
        h('div', {}, h('small', {}, 'Revenus prévus'), h('strong', {}, argent(m.revenus))),
        h('div', {}, h('small', {}, 'Dépenses'), h('strong', {}, argent(m.depenses)),
          h('small', { class: 'detail' }, `fixes ${argent(m.fixes)} · autres ${argent(m.variables)}`))),
      m.epicerie.base && vue.mois >= E.debut ? h('div', { class: 'ligne-epicerie' },
        h('span', {}, `🛒 Épicerie : ${argent(m.epicerie.reel)} dépensés`),
        m.epicerie.aVenir > 0 ? h('span', {}, `~${argent(m.epicerie.aVenir)} à venir`) : null) : null,
      parJour),

    vue.mois >= E.debut && vue.mois <= moisCourant() ? carteRythme(m) : null,
    vue.mois >= E.debut ? carteRepartition(m) : null,
    carteSixMois(d),
    moisActuel ? carteAVenir(d) : null);
}

// ------------------------------------------------------------------ graphiques de l'Accueil (SVG)
const ent = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 });
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** Élément SVG à partir d'un texte (valeurs numériques et libellés fixes seulement). */
function svg(markup) {
  const boite = document.createElement('div');
  boite.innerHTML = markup.trim();
  return boite.firstChild;
}
const legende = (classe, texte) => h('span', {}, h('span', { class: 'carre ' + classe }), texte);

/**
 * Rythme du mois : dépenses courantes (tout sauf les dépenses fixes) cumulées jour par jour,
 * comparées à une ligne droite = revenus prévus − fixes, répartis sur le mois (finir à 0 $).
 */
function carteRythme(m) {
  const jours = finDuMois(vue.mois).getDate();
  const enCours = vue.mois === moisCourant();
  const jourRef = enCours ? new Date().getDate() : jours;
  const budget = Math.max(0, m.revenus - m.fixes);
  const parJour = new Array(jours + 1).fill(0);
  for (const l of m.lignes) {
    if (l.type !== 'depense' || l.source === 'fixe') continue;
    const j = Number(String(l.date).slice(8, 10));
    if (j >= 1 && j <= jours) parJour[j] += Number(l.montant) || 0;
  }
  const cumul = [0];
  for (let j = 1; j <= jours; j++) cumul[j] = cumul[j - 1] + parJour[j];
  const maxY = Math.max(budget, cumul[jourRef], 1);
  const X = k => (30 + k / jours * 300).toFixed(1);
  const Y = v => (140 - v / maxY * 120).toFixed(1);
  const points = cumul.slice(0, jourRef + 1).map((v, k) => `${X(k)},${Y(v)}`).join(' ');
  const xa = X(jourRef), ya = Y(cumul[jourRef]);
  const milieu = Math.round(jours / 2);

  const attendu = budget * jourRef / jours;
  const ecart = attendu - cumul[jourRef];
  const phrase = budget <= 0
    ? h('p', { class: 'rythme-phrase negatif' }, 'Les dépenses fixes prennent déjà tous les revenus prévus.')
    : h('p', { class: 'rythme-phrase ' + (ecart >= 0 ? 'positif' : 'negatif') },
      (enCours ? '' : 'Mois terminé : ') + (ecart >= 0
        ? `${argent(ecart)} sous le rythme prévu ✓`
        : `${argent(-ecart)} au-dessus du rythme prévu`));

  return h('section', { class: 'carte' },
    h('h3', {}, '📈 Rythme du mois'),
    svg(`<svg class="graphe" viewBox="0 0 340 160" width="100%" role="img" aria-label="Dépenses courantes cumulées comparées au rythme prévu">
      <line class="g-axe" x1="30" y1="140" x2="330" y2="140"/>
      ${budget > 0 ? `<line class="g-prevu" x1="30" y1="140" x2="330" y2="${Y(budget)}"/>` : ''}
      ${enCours ? `<line class="g-repere" x1="${xa}" y1="30" x2="${xa}" y2="140"/>
        <text class="g-texte" x="${Math.min(Math.max(xa, 60), 300)}" y="24" text-anchor="middle">aujourd'hui</text>` : ''}
      <polyline class="g-courbe" points="${points}"/>
      <circle class="g-point" cx="${xa}" cy="${ya}" r="4.5"/>
      <text class="g-texte" x="30" y="156">1</text>
      <text class="g-texte" x="${X(milieu)}" y="156" text-anchor="middle">${milieu}</text>
      <text class="g-texte" x="330" y="156" text-anchor="end">${jours}</text>
    </svg>`),
    h('div', { class: 'legende' }, legende('s-courant', 'Tes dépenses courantes'), h('span', {}, h('span', { class: 'tiret' }), 'Rythme prévu')),
    phrase);
}

/** Où va l'argent du mois : revenus prévus = fixes + autres + épicerie à venir + restant. */
function carteRepartition(m) {
  const parts = [
    { nom: 'Fixes', v: m.fixes, c: 's-fixes' },
    { nom: 'Autres', v: m.variables, c: 's-autres' },
    { nom: 'Épicerie à venir', v: m.epicerie.aVenir, c: 's-epicerie' },
    { nom: 'Restant', v: Math.max(0, m.restant), c: 's-restant' }
  ].filter(p => p.v > 0);
  if (!parts.length) return null;
  const total = parts.reduce((s, p) => s + p.v, 0);
  const C = 2 * Math.PI * 50;
  let decal = 0;
  const arcs = parts.map(p => {
    const long = p.v / total * C;
    const arc = `<circle class="${p.c}" cx="60" cy="60" r="50" stroke-dasharray="${Math.max(0, long - 1.5).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-decal).toFixed(1)}"/>`;
    decal += long;
    return arc;
  }).join('');
  const depasse = m.restant < 0;
  const pctDe = v => m.revenus > 0 ? ` · ${Math.round(v / m.revenus * 100)} %` : '';
  return h('section', { class: 'carte' },
    h('h3', {}, '🍩 Où va l\'argent du mois'),
    h('div', { class: 'repartition' },
      svg(`<svg class="graphe anneau" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Répartition des revenus prévus du mois">
        <g transform="rotate(-90 60 60)" fill="none" stroke-width="18">${arcs}</g>
        <text class="g-texte" x="60" y="56" text-anchor="middle">${depasse ? 'dépassé de' : 'revenus'}</text>
        <text class="g-total${depasse ? ' negatif' : ''}" x="60" y="72" text-anchor="middle">${ent.format(depasse ? -m.restant : m.revenus)} $</text>
      </svg>`),
      h('div', { class: 'legende colonne' }, ...parts.map(p => legende(p.c, `${p.nom} ${argent(p.v)}${pctDe(p.v)}`)),
        depasse ? h('span', { class: 'negatif' }, `Restant ${argent(m.restant)}`) : null)));
}

/** Les 6 derniers mois (jusqu'au mois affiché) : ce qui restait à la fin de chaque mois. */
function carteSixMois(d) {
  const mois = [];
  for (let i = 5; i >= 0; i--) { const mt = decalerMois(vue.mois, -i); if (mt >= E.debut) mois.push(mt); }
  if (!mois.length) return null;
  const valeurs = mois.map(mt => ({ mt, v: calculerMois(d, mt).restant }));
  const max = Math.max(1, ...valeurs.map(x => Math.abs(x.v)));
  const pas = 300 / 6, base = 80, hauteurMax = 50;
  const barres = valeurs.map(({ mt, v }, i) => {
    const x = 10 + (6 - valeurs.length + i) * pas + (pas - 24) / 2, hBarre = Math.max(2, Math.abs(v) / max * hauteurMax);
    const y = v >= 0 ? base - hBarre : base;
    const pasFini = mt >= moisCourant();
    const etiquette = (v > 0 ? '+' : v < 0 ? '−' : '') + ent.format(Math.abs(v));
    const yTexte = v >= 0 ? y - 5 : y + hBarre + 13;
    return `<g class="g-mois${mt === vue.mois ? ' choisi' : ''}" data-mois="${mt}">
      <rect x="${x - (pas - 24) / 2}" y="0" width="${pas}" height="130" fill="transparent"/>
      <rect class="${v >= 0 ? 'g-pos' : 'g-neg'}${pasFini ? ' g-pasfini' : ''}" x="${x}" y="${y.toFixed(1)}" width="24" height="${hBarre.toFixed(1)}" rx="3"/>
      <text class="g-valeur" x="${x + 12}" y="${yTexte.toFixed(1)}" text-anchor="middle">${etiquette}</text>
      <text class="g-texte" x="${x + 12}" y="124" text-anchor="middle">${MOIS_COURTS[Number(mt.slice(5, 7)) - 1]}</text>
    </g>`;
  }).join('');
  const graphe = svg(`<svg class="graphe" viewBox="0 0 320 130" width="100%" role="img" aria-label="Ce qui restait à la fin de chacun des derniers mois">
    <line class="g-axe" x1="10" y1="${base}" x2="310" y2="${base}"/>${barres}</svg>`);
  for (const g of graphe.querySelectorAll('[data-mois]')) {
    g.addEventListener('click', () => { vue.mois = g.dataset.mois; dessiner(); window.scrollTo(0, 0); });
  }
  return h('section', { class: 'carte' },
    h('h3', {}, '📊 Les 6 derniers mois'),
    graphe,
    h('p', { class: 'aide' }, 'Ce qui restait à la fin de chaque mois. Barre pâle = mois pas encore fini. Touche une barre pour ouvrir ce mois.'));
}

/** Dépenses fixes et paies prévues d'aujourd'hui à 7 jours plus tard (peut déborder sur le mois suivant). */
function carteAVenir(d) {
  const debut = aujourdhui();
  const finD = new Date(); finD.setDate(finD.getDate() + 6);
  const fin = ymd(finD);
  const mois = [...new Set([debut.slice(0, 7), fin.slice(0, 7)])];
  const lignes = mois.flatMap(mt => calculerMois(d, mt).lignes)
    .filter(l => estFixe(l) && l.date >= debut && l.date <= fin)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'revenu' ? -1 : 1));
  const fmtDate = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
  return h('section', { class: 'carte' },
    h('h3', {}, '📆 À venir cette semaine'),
    lignes.length ? h('ul', { class: 'liste-avenir' }, ...lignes.map(l =>
      h('li', {},
        h('span', { class: 'avenir-date' }, l.date === debut ? 'Aujourd\'hui' : fmtDate.format(versDate(l.date))),
        h('span', { class: 'avenir-nom' }, `${icone(l.categorie)} ${l.commerce || l.sousCategorie || l.categorie}`),
        h('span', { class: 'avenir-montant ' + (l.type === 'revenu' ? 'positif' : '') },
          (l.type === 'revenu' ? '+ ' : '− ') + argent(l.montant)))))
      : h('p', { class: 'vide' }, 'Rien de prévu cette semaine.'));
}

/** Graphique « Dépenses par catégorie » d'un mois ; la barre verte compare à la plus grosse catégorie. */
function graphiqueCategories(moisTxt, surChoix) {
  const m = calculerMois(donneesCalc(), moisTxt);
  const maxCat = Math.max(1, ...m.parCategorie.map(c => c.total));
  return h('section', { class: 'carte' },
    h('h3', {}, `📊 Dépenses par catégorie — ${nomMois(moisTxt)}`),
    m.parCategorie.length ? h('ul', { class: 'liste-cat' }, ...m.parCategorie.map(c =>
      h('li', { onclick: () => surChoix(c.categorie) },
        h('span', { class: 'cat-nom' }, `${icone(c.categorie)} ${c.categorie}`),
        h('span', { class: 'cat-montant' }, argent(c.total)),
        h('span', { class: 'cat-barre' }, h('span', { style: { width: Math.round(c.total / maxCat * 100) + '%' } })))))
      : h('p', { class: 'vide' }, 'Aucune dépense ce mois-ci.'));
}

// ------------------------------------------------------------------ Mouvements du mois (+ recherche)
// Cases « Fixes et paies » / « Saisis par moi » : mémorisées sur cet appareil.
const voir = (() => {
  try { const v = JSON.parse(localStorage.getItem('voirMouvements')); if (v && typeof v.fixes === 'boolean') return v; } catch {}
  return { fixes: true, saisis: true };
})();
function caseVoir(cle, texte, classe) {
  return h('label', { class: 'case-voir ' + classe },
    h('input', { type: 'checkbox', checked: voir[cle], onchange: e => {
      voir[cle] = e.target.checked;
      try { localStorage.setItem('voirMouvements', JSON.stringify(voir)); } catch {}
      dessiner();
    } }), texte);
}

function ecranEntrees() {
  const loupe = h('button', {
    class: 'btn-icone loupe' + (vue.recherche ? ' actif' : ''), 'aria-label': vue.recherche ? 'Fermer la recherche' : 'Rechercher',
    onclick: () => { vue.recherche = vue.recherche ? null : { type: 'tout', categorie: '', texte: '' }; dessiner(); }
  }, vue.recherche ? '✕' : '🔍');

  if (!vue.recherche) {
    return h('div', {},
      h('div', { class: 'outils-entrees' }, selecteurMois(), loupe),
      h('div', { class: 'cases-voir' },
        caseVoir('fixes', '📌 Fixes et paies', 'fixe'),
        caseVoir('saisis', '✍️ Saisis par moi', 'saisi')),
      vue.filtre ? h('button', { class: 'puce filtre', onclick: () => { vue.filtre = null; dessiner(); } }, `${icone(vue.filtre)} ${vue.filtre} ✕`) : null,
      ecranTransactions(vue.mois, vue.filtre, voir));
  }

  const r = vue.recherche;
  const resultats = h('div', {});
  // Choix manuel dans les listes : recherche dans tout le fichier (plus de limite au mois du graphique).
  const type = h('select', { onchange: () => { r.type = type.value; r.categorie = ''; r.mois = ''; remplirCategories(); majResultats(); } },
    h('option', { value: 'tout' }, 'Tout'), h('option', { value: 'revenu' }, 'Revenus'), h('option', { value: 'depense' }, 'Dépenses'));
  type.value = r.type;
  const categorie = h('select', { onchange: () => { r.categorie = categorie.value; r.mois = ''; majResultats(); } });
  function remplirCategories() {
    const types = r.type === 'tout' ? ['depense', 'revenu'] : [r.type];
    const noms = [...new Set(E.categories.filter(c => types.includes(c.type)).map(c => c.categorie))];
    // Catégories utilisées dans des mouvements mais retirées de la liste : les garder cherchables.
    for (const t of E.transactions) if (!t.supprime && types.includes(t.type) && t.categorie && !noms.includes(t.categorie)) noms.push(t.categorie);
    categorie.replaceChildren(h('option', { value: '' }, 'Toutes les catégories'),
      ...noms.sort((a, b) => a.localeCompare(b, 'fr')).map(n => h('option', { value: n }, `${icone(n)} ${n}`)));
    categorie.value = noms.includes(r.categorie) ? r.categorie : '';
  }
  remplirCategories();
  const texte = h('input', { type: 'search', id: 'recherche-texte', value: r.texte, placeholder: 'Commerce, note, montant…', autocomplete: 'off',
    oninput: () => { r.texte = texte.value; majResultats(); } });

  function majResultats() {
    const groupes = rechercherEntrees(r);
    const somme = type => groupes.flat().filter(l => l.type === type).reduce((s, l) => s + Number(l.montant), 0);
    const totaux = [r.type !== 'depense' && `revenus ${argent(somme('revenu'))}`, r.type !== 'revenu' && `dépenses ${argent(somme('depense'))}`].filter(Boolean).join(' · ');
    resultats.replaceChildren(...[
      r.mois ? h('button', { class: 'puce filtre', onclick: () => { r.mois = ''; majResultats(); } },
        `📅 ${nomMois(r.mois)} seulement ✕`) : null,
      h('p', { class: 'aide' }, groupes.length
        ? `${groupes.length} résultat${groupes.length > 1 ? 's' : ''} · ${totaux}`
        : 'Aucun résultat.'),
      groupes.length ? listeEntrees(groupes, { avecAnnee: !r.mois }) : null].filter(Boolean));
  }
  majResultats();

  // Toucher une catégorie du graphique : Dépenses + cette catégorie, pour le mois du graphique seulement.
  const graphique = graphiqueCategories(vue.mois, cat => {
    Object.assign(r, { type: 'depense', categorie: cat, mois: vue.mois });
    type.value = 'depense'; remplirCategories(); majResultats();
    resultats.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  return h('div', {},
    h('div', { class: 'outils-entrees' }, h('h3', { class: 'titre-recherche' }, '🔍 Recherche dans les mouvements'), loupe),
    graphique,
    h('section', { class: 'carte recherche' },
      h('label', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Item(s) à rechercher'), type),
      h('label', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Catégorie'), categorie),
      h('label', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Texte à rechercher'), texte)),
    resultats);
}

// ------------------------------------------------------------------ Année
function ecranAnnee() {
  const annee = Number(vue.mois.slice(0, 4));
  const a = calculerAnnee(donneesCalc(), annee);
  const courant = moisCourant();
  // Liste des années : de l'année suivante (toujours 1 an d'avance) jusqu'à la plus ancienne ayant des données.
  const anneeCourante = Number(courant.slice(0, 4));
  let plusAncienne = Math.min(anneeCourante, Number(String(E.debut).slice(0, 4)) || anneeCourante, annee);
  for (const t of E.transactions) {
    const y = Number(String(t.mois || t.date || '').slice(0, 4));
    if (!t.supprime && y >= 2000 && y < plusAncienne) plusAncienne = y;
  }
  const choixAnnee = h('select', { class: 'choix-annee', 'aria-label': 'Année', onchange: () => {
    vue.mois = `${choixAnnee.value}-${vue.mois.slice(5, 7)}`; dessiner();
  } });
  for (let y = Math.max(anneeCourante + 1, annee); y >= plusAncienne; y--) choixAnnee.append(h('option', { value: String(y) }, String(y)));
  choixAnnee.value = String(annee);
  return h('div', {},
    h('div', { class: 'selecteur-mois centre-annee' }, choixAnnee),
    h('section', { class: 'carte annee-resume' }, h('div', { class: 'deux-col' },
      h('div', {}, h('small', {}, 'Cumul depuis janvier'), h('strong', { class: a.cumul >= 0 ? 'positif' : 'negatif' }, argent(a.cumul))),
      h('div', {}, h('small', {}, 'Projection fin d\'année'), h('strong', { class: a.projection >= 0 ? 'positif' : 'negatif' }, argent(a.projection))))),
    h('div', { class: 'grille-annee' }, ...a.mois.map(m => h('button', {
      class: 'case-mois ' + (!m.actif ? 'inactif' : m.restant >= 0 ? 'positif' : 'negatif') + (m.mois === courant ? ' courant' : '') + (m.mois > courant ? ' futur' : ''),
      onclick: () => aller('accueil', { mois: m.mois })
    }, h('small', {}, nomMoisCourt(m.mois)), h('strong', {}, m.actif ? argent(m.restant) : '—')))),
    h('p', { class: 'aide centre' }, 'Mois futurs : selon les revenus et dépenses fixes prévus. Chaque mois est indépendant.'),
    carteRecap(annee, a));
}

// ------------------------------------------------------------------ Récap de l'année (page Année)
// Par catégorie / sous-catégorie : dépenses FIXES de toute l'année (passées + à venir) et dépenses ENTRÉES
// jusqu'à aujourd'hui. Moyennes : fixes sur l'année complète, entrées sur la période déjà écoulée.
// L'épicerie prévue (onglet Récurrents) n'est pas une ligne : seules les épiceries entrées comptent.
let recapMode = (() => { try { return localStorage.getItem('recapMode') || 'total'; } catch { return 'total'; } })();
const recapOuvertes = new Set();

function carteRecap(annee, a) {
  const auj = aujourdhui();
  const debutAnnee = `${annee}-01-01`, finAnnee = `${annee}-12-31`;
  const debutSuivi = String(E.debut || '') + '-01';
  const du = debutSuivi > debutAnnee ? debutSuivi : debutAnnee;
  const au = auj < finAnnee ? auj : finAnnee;
  const nbJours = (x, y) => x <= y ? Math.round((versDate(y) - versDate(x)) / 86400000) + 1 : 0;
  const joursAnnee = nbJours(du, finAnnee);   // période des dépenses fixes (année complète suivie)
  const joursEcoules = nbJours(du, au);        // période des dépenses entrées (jusqu'à aujourd'hui)
  const moisSuivis = a.mois.filter(m => m.actif).length;

  const vide = () => ({ fixe: 0, entre: 0 });
  const ajouter = (acc, t, v, date) => {
    if (t.source === 'fixe') acc.fixe += v; else acc.entre += v;
  };
  const cats = new Map();
  const total = vide();
  for (const m of a.mois) {
    if (!m.actif) continue;
    for (const t of m.lignes) {
      if (t.type !== 'depense') continue;
      const v = Number(t.montant) || 0;
      if (!v) continue;
      const date = t.date || m.mois + '-01';
      if (t.source !== 'fixe' && date > auj) continue; // dépense entrée datée dans le futur : pas encore faite
      const c = cats.get(t.categorie) || { ...vide(), sous: new Map() };
      ajouter(c, t, v, date);
      const nomSous = t.sousCategorie || '(sans sous-catégorie)';
      const sc = c.sous.get(nomSous) || vide();
      ajouter(sc, t, v, date);
      c.sous.set(nomSous, sc);
      cats.set(t.categorie, c);
      ajouter(total, t, v, date);
    }
  }

  const parPeriode = recapMode === 'mois' ? 365.25 / 12 : recapMode === 'semaine' ? 7 : 0;
  const montant = acc => {
    if (!parPeriode) return acc.fixe + acc.entre;
    // Fixes par mois : ÷ nombre de mois suivis (loyer 1 500 $ → 1 500 $/mois pile) ; par semaine : ÷ semaines.
    const fixe = recapMode === 'mois' ? (moisSuivis ? acc.fixe / moisSuivis : 0) : (joursAnnee ? acc.fixe / (joursAnnee / 7) : 0);
    return fixe + (joursEcoules ? acc.entre / (joursEcoules / parPeriode) : 0);
  };
  const suffixe = recapMode === 'mois' ? ' /mois' : recapMode === 'semaine' ? ' /sem.' : '';

  const bouton = (cle, texte) => h('button', {
    class: 'seg' + (recapMode === cle ? ' actif' : ''), 'aria-pressed': String(recapMode === cle),
    onclick: () => { recapMode = cle; try { localStorage.setItem('recapMode', cle); } catch {} dessiner(); }
  }, texte);

  const estEpi = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'epicerie';
  const note = texte => h('span', { class: 'recap-note' }, texte);
  const notes = (acc, epicerie) => [epicerie ? note('montants entrés seulement') : null];

  const triees = [...cats.entries()].sort((x, y) => montant(y[1]) - montant(x[1]));
  const lignes = triees.map(([nom, c]) => {
    const ouverte = recapOuvertes.has(nom);
    const aEpicerie = [...c.sous.keys()].some(estEpi);
    const li = h('li', { class: 'recap-cat' + (ouverte ? ' ouverte' : '') },
      h('button', { class: 'recap-tete', 'aria-expanded': String(ouverte), onclick: () => {
        if (ouverte) recapOuvertes.delete(nom); else recapOuvertes.add(nom); dessiner();
      } },
        h('span', { class: 'recap-nom' }, `${ouverte ? '▾' : '▸'} ${icone(nom)} ${nom}`, ...(ouverte ? [] : notes(c, aEpicerie))),
        h('span', { class: 'cat-montant' }, argent(montant(c)))));
    if (ouverte) {
      li.append(h('ul', { class: 'recap-sous' }, ...[...c.sous.entries()].sort((x, y) => montant(y[1]) - montant(x[1])).map(([s, sc]) =>
        h('li', {}, h('span', {}, s, ...notes(sc, estEpi(s))), h('span', { class: 'cat-montant' }, argent(montant(sc)))))));
    }
    return li;
  });

  const fmtJour = d => { const x = versDate(d); return `${x.getDate() === 1 ? '1er' : x.getDate()} ${nomMoisCourt(d.slice(0, 7)).toLowerCase()}`; };
  const explications = [];
  if (joursAnnee) {
    explications.push(`Dépenses fixes : toute l'année ${annee}, y compris celles à venir.`);
    explications.push(joursEcoules
      ? `Dépenses entrées : du ${fmtJour(du)} au ${fmtJour(au)} ${au.slice(0, 4)} (${joursEcoules} jours).`
      : 'Dépenses entrées : aucune pour l\'instant (année pas encore commencée).');
    if (parPeriode) explications.push(`Moyenne ${recapMode === 'mois' ? 'par mois' : 'par semaine'} : les fixes sur l'année complète, les dépenses entrées sur la période déjà écoulée.`);
    explications.push('L\'épicerie prévue ne compte pas.');
  }

  return h('section', { class: 'carte recap' },
    h('div', { class: 'recap-entete' },
      h('h3', {}, `📋 Récap ${annee}`),
      h('div', { class: 'segments', role: 'group', 'aria-label': 'Affichage' },
        bouton('total', 'Total'), bouton('mois', '/mois'), bouton('semaine', '/semaine'))),
    triees.length
      ? h('ul', { class: 'liste-recap' }, ...lignes,
          h('li', { class: 'recap-total' }, h('span', {}, 'Total des dépenses'), h('span', { class: 'cat-montant' }, argent(montant(total)) + suffixe)))
      : h('p', { class: 'vide' }, joursAnnee ? 'Aucune dépense pour cette année.' : 'Le suivi n\'avait pas encore commencé cette année-là.'),
    explications.length ? h('p', { class: 'aide' }, explications.join(' ')) : null);
}

demarrer().catch(e => {
  console.error(e);
  racine.textContent = 'Erreur au démarrage : ' + e.message;
});

export { ouvrirSaisie };
