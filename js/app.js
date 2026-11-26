// Point d'entrée : démarrage, verrou, navigation et écrans Accueil / Mouvements / Année (Récurrents et Réglages : reglages.js).
import { h, vider, toast, fermerDerniere } from './ui.js';
import { surChangement, getMeta } from './db.js';
import { E, charger, initialiserSiVide, materialiser, donneesCalc, icone, revenusAConfirmer, reglage } from './etat.js';
import { calculerMois, calculerAnnee, argent, moisCourant, decalerMois, nomMois, nomMoisCourt } from './calc.js';
import { demarrerSyncAuto, surEtatSync, synchroniser } from './sync.js';
import { nipDefini, verifierNip, biometrieActive, biometrieDisponible, deverrouillerBiometrie, activerBiometrie, surveillerArrierePlan } from './lock.js';
import { ouvrirAjout, ecranTransactions, ouvrirConfirmations, ouvrirSaisie, rechercherEntrees, listeEntrees } from './saisie.js';
import { ecranReglages, ecranRecurrents, choisirMoi, demanderNouveauNip, configurerSync } from './reglages.js';
import { ouvrirPhoto } from './ocr.js';

const racine = document.getElementById('app');
const vue = { ecran: 'accueil', mois: moisCourant(), filtre: null };
let deverrouille = false;
let confirmationsMontrees = false;

// ------------------------------------------------------------------ démarrage
async function demarrer() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  await initialiserSiVide();
  await charger();
  if (!(await nipDefini())) return accueilPremiereFois();
  await ecranVerrou();
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
  const annee = Number(vue.mois.slice(0, 4));
  const a = calculerAnnee(d, annee, vue.mois < moisCourant() ? vue.mois : moisCourant());
  const aConfirmer = revenusAConfirmer();
  const pct = m.revenus > 0 ? Math.min(100, Math.round(m.depenses / m.revenus * 100)) : (m.depenses > 0 ? 100 : 0);
  const maxCat = Math.max(1, ...m.parCategorie.map(c => c.total));
  const signe = v => v >= 0 ? 'positif' : 'negatif';

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
        m.epicerie.aVenir > 0 ? h('span', {}, `~${argent(m.epicerie.aVenir)} à venir`) : null) : null),

    h('section', { class: 'carte annee-resume' },
      h('h3', {}, `Année ${annee}`),
      h('div', { class: 'deux-col' },
        h('div', {}, h('small', {}, 'Cumul depuis janvier'), h('strong', { class: signe(a.cumul) }, argent(a.cumul))),
        h('div', {}, h('small', {}, 'Projection fin d\'année'), h('strong', { class: signe(a.projection) }, argent(a.projection))))),

    h('section', { class: 'carte' },
      h('h3', {}, 'Dépenses par catégorie'),
      m.parCategorie.length ? h('ul', { class: 'liste-cat' }, ...m.parCategorie.map(c =>
        h('li', { onclick: () => aller('transactions', { filtre: c.categorie }) },
          h('span', { class: 'cat-nom' }, `${icone(c.categorie)} ${c.categorie}`),
          h('span', { class: 'cat-montant' }, argent(c.total)),
          h('span', { class: 'cat-barre' }, h('span', { style: { width: Math.round(c.total / maxCat * 100) + '%' } })))))
        : h('p', { class: 'vide' }, 'Aucune dépense ce mois-ci. Appuie sur ＋ pour en ajouter une.')));
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
  const type = h('select', { onchange: () => { r.type = type.value; r.categorie = ''; remplirCategories(); majResultats(); } },
    h('option', { value: 'tout' }, 'Tout'), h('option', { value: 'revenu' }, 'Revenus'), h('option', { value: 'depense' }, 'Dépenses'));
  type.value = r.type;
  const categorie = h('select', { onchange: () => { r.categorie = categorie.value; majResultats(); } });
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
    resultats.replaceChildren(
      h('p', { class: 'aide' }, groupes.length
        ? `${groupes.length} résultat${groupes.length > 1 ? 's' : ''} · ${totaux}`
        : 'Aucun résultat.'),
      groupes.length ? listeEntrees(groupes, { avecAnnee: true }) : null);
  }
  majResultats();

  return h('div', {},
    h('div', { class: 'outils-entrees' }, h('h3', { class: 'titre-recherche' }, '🔍 Recherche dans tous les mouvements'), loupe),
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
    h('p', { class: 'aide centre' }, 'Mois futurs : selon les revenus et dépenses fixes prévus. Chaque mois est indépendant.'));
}

demarrer().catch(e => {
  console.error(e);
  racine.textContent = 'Erreur au démarrage : ' + e.message;
});

export { ouvrirSaisie };
