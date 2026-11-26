// Écran Réglages (profil, sécurité, synchro, catégories, commerces) et onglet Récurrents (revenus récurrents, dépenses fixes).
import { h, feuille, toast, confirmer, champ, champMontant, lireMontant } from './ui.js';
import { E, categoriesPar, icone, reglage, rafraichirPrevus, utilisateurs, epicerie } from './etat.js';
import { sauver, supprimer, getMeta, setMeta, uuid } from './db.js';
import { argent, FREQUENCES_FIXES, UNITES, intervalle, libelleFrequence, premierPaiement, datesChoisies, moisDuFixe, datesFixe, decalerMois, historiqueDe, montantA, montantFixe, aujourdhui, moisCourant, nomMois, normaliser, epicerieDuMois } from './calc.js';
import { tester, synchroniser } from './sync.js';
import { definirNip, verifierNip, biometrieDisponible, biometrieActive, activerBiometrie, desactiverBiometrie } from './lock.js';

const SEP = '¦';
const FREQ_REVENUS = { hebdo: 'Chaque semaine', '2sem': 'Aux 2 semaines', mensuel: 'Chaque mois', annuel: 'Une fois par année' };
const NOMS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function section(titre, ...contenu) {
  return h('section', { class: 'carte reglage' }, h('h3', {}, titre), ...contenu);
}
function rangee(texte, detail, onclick, droite = '›', classe = '') {
  return h('button', { class: 'rangee' + (classe ? ' ' + classe : ''), onclick },h('span', {}, h('strong', {}, texte), detail ? h('small', {}, detail) : null), h('span', { class: 'chevron' }, droite));
}

export async function ecranReglages(rafraichir) {
  const racine = h('div', { class: 'reglages' });
  const apiUrl = (await getMeta('apiUrl')) || '';
  const bioDispo = await biometrieDisponible();
  const bioActive = await biometrieActive();

  // ---- Profil
  racine.append(section('👤 Profil',
    rangee('Je suis', E.moi || '—', () => choisirMoi(rafraichir)),
    rangee('Utilisateurs du budget', utilisateurs().join(', ') || '—', () => modifierUtilisateurs(rafraichir)),
    rangee('Début du suivi', nomMois(E.debut), () => modifierDebut(rafraichir))));

  // ---- Sécurité
  racine.append(section('🔒 Sécurité',
    rangee('Changer le NIP', null, () => changerNip()),
    bioDispo ? rangee('Déverrouillage biométrique', bioActive ? 'Activé' : 'Désactivé', async () => {
      try {
        if (bioActive) { await desactiverBiometrie(); toast('Biométrie désactivée'); }
        else { await activerBiometrie(E.moi); toast('Biométrie activée ✓'); }
      } catch { toast('Biométrie annulée', 'erreur'); }
      rafraichir();
    }) : h('p', { class: 'aide' }, 'Biométrie non disponible sur cet appareil (NIP seulement).')));

  // ---- Synchro
  racine.append(section('🔄 Synchronisation',
    rangee('Connexion au Google Sheets', apiUrl ? 'Configurée' : 'À configurer', () => configurerSync(rafraichir)),
    rangee('Synchroniser maintenant', null, async () => { await synchroniser(); toast('Synchro lancée'); }, '↻')));

  // ---- Catégories
  racine.append(section('🗂️ Catégories',
    rangee('Catégories de dépenses', `${categoriesPar('depense').size} catégories`, () => gererCategories('depense', rafraichir)),
    rangee('Catégories de revenus', `${categoriesPar('revenu').size} catégories`, () => gererCategories('revenu', rafraichir)),
    rangee('Commerces connus', `${E.commerces.length} commerces`, () => gererCommerces(rafraichir))));

  racine.append(h('p', { class: 'aide centre' }, 'Budget · v10'));
  return racine;
}

// Onglet « Récurrents » : revenus récurrents et dépenses fixes.
export function ecranRecurrents(rafraichir) {
  const racine = h('div', { class: 'reglages' });

  const ep = epicerie();
  racine.append(section('🛒 Épicerie',
    rangee('Montant prévu', ep.montant
      ? `${argent(ep.montant)} par ${ep.frequence}${ep.frequence === 'semaine' ? ` · ≈ ${argent(epicerieDuMois(ep, moisCourant()))} ce mois` : ''}`
      : 'Aucun — touche pour en ajouter un', () => modifierEpicerie(rafraichir))));

  const revs = E.revenus.map(r => rangee(r.nom,
    `${FREQ_REVENUS[r.frequence] || ''} · ${argent(montantA(r, aujourdhui()))}${r.personne ? ' · ' + r.personne : ''}${r.actif === false ? ' · inactif' : ''}`,
    () => modifierRevenu(r, rafraichir), '›', r.actif === false ? 'inactif' : ''));
  racine.append(section('💵 Revenus récurrents', ...revs,
    h('button', { class: 'btn lien', onclick: () => modifierRevenu(null, rafraichir) }, '➕ Ajouter un revenu récurrent')));

  const fixes = E.fixes.map(f => rangee(f.nom,
    `${libelleFrequence(f.frequence)}${premierPaiement(f) ? ` · dès le ${premierPaiement(f)}` : ''} · ${argent(montantFixe(f, aujourdhui()))} · ${f.categorie}${f.actif === false ? ' · inactif' : ''}`,
    () => modifierFixe(f, rafraichir), '›', f.actif === false ? 'inactif' : ''));
  racine.append(section('📌 Dépenses fixes', ...fixes,
    h('button', { class: 'btn lien', onclick: () => modifierFixe(null, rafraichir) }, '➕ Ajouter une dépense fixe')));

  return racine;
}

// ------------------------------------------------------------------ Épicerie (montant prévu)
function modifierEpicerie(rafraichir) {
  feuille('🛒 Épicerie', (corps, fermer) => {
    const ep = epicerie();
    const montant = champMontant(ep.montant || '');
    const freq = h('select', {}, h('option', { value: 'semaine', selected: ep.frequence === 'semaine' }, 'Par semaine'),
      h('option', { value: 'mois', selected: ep.frequence === 'mois' }, 'Par mois'));
    corps.append(h('form', { class: 'formulaire', onsubmit: async e => {
      e.preventDefault();
      const m = montant.value.trim() ? lireMontant(montant.value) : 0;
      if (m === null || m < 0) return toast('Montant invalide', 'erreur');
      await reglage('epicerieMontant', String(m));
      await reglage('epicerieFrequence', freq.value);
      E.reglages.epicerieMontant = String(m); E.reglages.epicerieFrequence = freq.value;
      fermer(); rafraichir(); toast(m ? 'Montant d\'épicerie enregistré ✓' : 'Estimation d\'épicerie retirée');
    } },
      h('p', { class: 'aide' }, 'Ce montant sert à prévoir l\'épicerie des jours qui ne sont pas encore passés. Les jours passés comptent '
        + 'seulement ce que tu as vraiment entré (sous-catégorie Épicerie). À la fin du mois, il ne reste que le réel.'),
      champ('Montant prévu', montant, 'Laisse vide (ou 0) pour ne pas estimer l\'épicerie.'),
      champ('Fréquence', freq),
      h('div', { class: 'rangee-boutons' }, h('button', { type: 'submit', class: 'btn primaire' }, 'Enregistrer'))));
  });
}

// ------------------------------------------------------------------ Profil
export function choisirMoi(rafraichir, obligatoire = false) {
  return new Promise(resolve => {
    feuille('Je suis…', (corps, fermer) => {
      const noms = utilisateurs();
      const autre = h('input', { type: 'text', placeholder: 'Ton prénom' });
      async function choisir(nom) {
        nom = nom.trim();
        if (!nom) return;
        await setMeta('moi', nom);
        E.moi = nom;
        if (!noms.includes(nom)) await reglage('utilisateurs', [...noms, nom].join(','));
        fermer(nom);
      }
      corps.append(
        ...noms.map(n => h('button', { class: 'btn secondaire large', onclick: () => choisir(n) }, n)),
        h('form', { class: 'formulaire', onsubmit: e => { e.preventDefault(); choisir(autre.value); } },
          champ(noms.length ? 'Ou un autre prénom' : 'Prénom', autre),
          h('button', { type: 'submit', class: 'btn primaire' }, 'Continuer')));
    }, { surFermer: v => { resolve(v); rafraichir && rafraichir(); } });
  });
}

function modifierUtilisateurs(rafraichir) {
  feuille('Utilisateurs du budget', (corps, fermer) => {
    const champTxt = h('input', { type: 'text', value: utilisateurs().join(', ') });
    corps.append(h('form', { class: 'formulaire', onsubmit: async e => {
      e.preventDefault();
      const liste = champTxt.value.split(',').map(s => s.trim()).filter(Boolean);
      await reglage('utilisateurs', liste.join(','));
      fermer(); rafraichir();
    } }, champ('Prénoms séparés par des virgules', champTxt, 'Ex. : Samuel, Marie. Sert au champ « Saisi par » et aux paies.'),
      h('button', { type: 'submit', class: 'btn primaire' }, 'Enregistrer')));
  });
}

function modifierDebut(rafraichir) {
  feuille('Début du suivi', (corps, fermer) => {
    const m = h('input', { type: 'month', value: E.debut });
    corps.append(h('form', { class: 'formulaire', onsubmit: async e => {
      e.preventDefault();
      if (!m.value) return;
      await reglage('debut', m.value);
      fermer(); rafraichir();
    } }, champ('Premier mois suivi', m, 'Les paies et dépenses fixes sont prévues à partir de ce mois.'),
      h('button', { type: 'submit', class: 'btn primaire' }, 'Enregistrer')));
  });
}

// ------------------------------------------------------------------ Sécurité
export function demanderNouveauNip() {
  return new Promise(resolve => {
    feuille('Choisis un NIP', (corps, fermer) => {
      const a = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 8, autocomplete: 'new-password' });
      const b = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 8, autocomplete: 'new-password' });
      corps.append(h('form', { class: 'formulaire', onsubmit: async e => {
        e.preventDefault();
        if (!/^\d{4,8}$/.test(a.value)) return toast('4 à 8 chiffres', 'erreur');
        if (a.value !== b.value) return toast('Les deux NIP ne correspondent pas', 'erreur');
        await definirNip(a.value);
        fermer(true);
      } }, champ('NIP (4 à 8 chiffres)', a), champ('Confirme le NIP', b),
        h('button', { type: 'submit', class: 'btn primaire' }, 'Enregistrer')));
      setTimeout(() => a.focus(), 250);
    }, { surFermer: v => resolve(!!v) });
  });
}

function changerNip() {
  feuille('Changer le NIP', (corps, fermer) => {
    const actuel = h('input', { type: 'password', inputmode: 'numeric', maxlength: 8 });
    corps.append(h('form', { class: 'formulaire', onsubmit: async e => {
      e.preventDefault();
      if (!await verifierNip(actuel.value)) return toast('NIP actuel incorrect', 'erreur');
      fermer();
      if (await demanderNouveauNip()) toast('NIP modifié ✓');
    } }, champ('NIP actuel', actuel), h('button', { type: 'submit', class: 'btn primaire' }, 'Continuer')));
  });
}

// ------------------------------------------------------------------ Synchro
export function configurerSync(rafraichir) {
  return new Promise(resolve => {
    feuille('Connexion au Google Sheets', async (corps, fermer) => {
      const url = h('input', { type: 'url', value: (await getMeta('apiUrl')) || '', placeholder: 'https://script.google.com/macros/s/…/exec' });
      const jeton = h('input', { type: 'password', value: (await getMeta('jeton')) || '', autocomplete: 'off' });
      const statut = h('p', { class: 'aide' });
      corps.append(h('form', { class: 'formulaire', onsubmit: async e => {
        e.preventDefault();
        statut.textContent = 'Vérification…';
        try {
          const rep = await tester(url.value.trim(), jeton.value.trim());
          await setMeta('apiUrl', url.value.trim());
          await setMeta('jeton', jeton.value.trim());
          toast(`Connecté à « ${rep.fichier} » ✓`);
          fermer(true);
          synchroniser();
        } catch (err) {
          statut.textContent = err.message === 'jeton-invalide' ? '❌ Jeton secret invalide.' : '❌ Impossible de joindre le script. Vérifie l\'adresse et ta connexion.';
        }
      } }, champ('Adresse de l\'application Web (finit par /exec)', url),
        champ('Jeton secret', jeton, 'Affiché dans le journal d\'Apps Script à l\'étape « configurer ».'),
        statut, h('button', { type: 'submit', class: 'btn primaire' }, 'Tester et enregistrer')));
    }, { surFermer: v => { resolve(!!v); rafraichir && rafraichir(); } });
  });
}

// ------------------------------------------------------------------ Revenus récurrents
function modifierRevenu(r, rafraichir) {
  const nouveau = !r;
  r = r || { id: uuid(), nom: '', personne: E.moi, frequence: 'hebdo', dateReference: '', categorie: 'Salaire', sousCategorie: 'Paie', montant: '', historique: '[]', actif: true };
  feuille(nouveau ? 'Nouveau revenu récurrent' : r.nom, (corps, fermer) => {
    const nom = h('input', { type: 'text', value: r.nom, placeholder: 'Ex. : Paie Samuel, Allocations' });
    const personne = h('select', {}, h('option', { value: '' }, 'Commun (tout le monde)'),
      ...utilisateurs().map(u => h('option', { value: u, selected: u === r.personne }, u)));
    const freq = h('select', {}, ...Object.entries(FREQ_REVENUS).map(([k, v]) => h('option', { value: k, selected: k === r.frequence }, v)));
    const ref = h('input', { type: 'date', value: r.dateReference || '' });
    const cat = h('select', {});
    for (const [c, sous] of categoriesPar('revenu')) {
      const g = h('optgroup', { label: c });
      for (const s of sous) g.append(h('option', { value: c + SEP + s, selected: c === r.categorie && s === r.sousCategorie }, s));
      cat.append(g);
    }
    const hist = historiqueDe(r);
    const montant = champMontant(nouveau ? '' : montantA(r, aujourdhui()));
    const aPartirDu = h('input', { type: 'date', value: aujourdhui() });
    const actif = h('input', { type: 'checkbox', checked: r.actif !== false });

    const histTexte = hist.length > 1 ? h('small', { class: 'aide' }, 'Historique : ',
      hist.map(e => `${argent(e.montant)} dès le ${e.du}`).join(' · ')) : null;

    corps.append(h('form', { class: 'formulaire', onsubmit: async e => {
      e.preventDefault();
      const m = lireMontant(montant.value);
      if (!nom.value.trim() || m === null || !ref.value) return toast('Nom, date et montant requis', 'erreur');
      let h2 = hist;
      if (nouveau || !h2.length) h2 = [{ du: ref.value, montant: m }];
      else if (m !== montantA(r, aPartirDu.value)) {
        h2 = h2.filter(x => x.du < aPartirDu.value).concat([{ du: aPartirDu.value, montant: m }]);
        if (!h2.some(x => x.du <= ref.value)) h2.unshift({ du: ref.value, montant: hist[0].montant });
      }
      const [c, s] = cat.value.split(SEP);
      const rec = { ...r, nom: nom.value.trim(), personne: personne.value, frequence: freq.value, dateReference: ref.value,
        categorie: c, sousCategorie: s, montant: h2[h2.length - 1].montant, historique: JSON.stringify(h2), actif: actif.checked };
      await sauver('Revenus', rec);
      E.revenus = E.revenus.filter(x => x.id !== rec.id).concat(rec);
      await rafraichirPrevus(rec.id);
      fermer(); rafraichir(); toast('Revenu enregistré ✓');
    } },
      champ('Nom', nom),
      champ('Personne', personne, 'La confirmation de chaque paie apparaît seulement sur le téléphone de cette personne.'),
      champ('Fréquence', freq),
      champ('Date d\'un versement connu', ref, 'Ex. : la première paie de l\'année. Les suivantes sont calculées à partir d\'elle.'),
      champ('Catégorie', cat),
      champ('Montant net par versement', montant),
      nouveau ? null : champ('Ce montant s\'applique à partir du', aPartirDu, 'Les versements avant cette date gardent l\'ancien montant.'),
      histTexte,
      h('label', { class: 'case' }, actif, ' Actif'),
      h('div', { class: 'rangee-boutons' },
        nouveau ? null : h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!await confirmer(`Supprimer « ${r.nom} » ? Les versements déjà confirmés sont conservés.`, { oui: 'Supprimer', danger: true })) return;
          await supprimer('Revenus', r.id);
          E.revenus = E.revenus.filter(x => x.id !== r.id);
          await rafraichirPrevus(r.id);
          fermer(); rafraichir();
        } }, 'Supprimer'),
        h('button', { type: 'submit', class: 'btn primaire' }, 'Enregistrer'))));
  });
}

// ------------------------------------------------------------------ Dépenses fixes
function modifierFixe(f, rafraichir) {
  const nouveau = !f;
  f = f || { id: uuid(), nom: '', categorie: '', sousCategorie: '', montant: '', frequence: 'mensuel', moisPaiement: '', motsCles: '', actif: true, dateReference: '', historique: '[]' };
  feuille(nouveau ? 'Nouvelle dépense fixe' : f.nom, (corps, fermer) => {
    const hist = historiqueDe(f);
    const montantActuel = nouveau ? '' : montantFixe(f, aujourdhui());
    const nom = h('input', { type: 'text', value: f.nom, placeholder: 'Ex. : Hypothèque, Hydro-Québec' });
    const cat = h('select', {}, h('option', { value: '' }, '— Choisir —'));
    for (const [c, sous] of categoriesPar('depense')) {
      const g = h('optgroup', { label: `${icone(c)} ${c}` });
      for (const s of sous) g.append(h('option', { value: c + SEP + s, selected: c === f.categorie && s === f.sousCategorie }, s));
      cat.append(g);
    }
    const montant = champMontant(montantActuel);
    const aPartirDu = h('input', { type: 'date', value: aujourdhui() });

    // Fréquence (« Tous les X… » = perso:X:unité)
    const estPerso = String(f.frequence).startsWith('perso:');
    const freq = h('select', { onchange: () => majZones() }, ...Object.entries(FREQUENCES_FIXES).map(([k, v]) =>
      h('option', { value: k, selected: estPerso ? k === 'perso' : k === f.frequence }, v)));
    const ivPerso = estPerso ? intervalle(f.frequence) : { n: 2, unite: 'semaines' };
    const nbPerso = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 365, step: 1, value: String(ivPerso.n), class: 'nb-perso' });
    const tousLes = h('span', {});
    const unitePerso = h('select', { onchange: () => majTousLes() }, ...Object.entries(UNITES).map(([k, [, , nomListe]]) =>
      h('option', { value: k, selected: k === ivPerso.unite }, nomListe)));
    const majTousLes = () => { tousLes.textContent = unitePerso.value === 'semaines' ? 'Toutes les' : 'Tous les'; };
    majTousLes();
    const zonePerso = h('div', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Délai personnalisé'),
      h('div', { class: 'rangee-perso' }, tousLes, nbPerso, unitePerso),
      h('small', { class: 'aide' }, 'Ex. : tous les 10 jours, toutes les 3 semaines, tous les 6 mois, tous les 2 ans.'));

    // Date du premier paiement (calendrier). Anciennes données sans date : premier paiement depuis le début du suivi.
    let premier = premierPaiement(f) || '';
    if (!premier && !nouveau) {
      for (let m = E.debut, i = 0; i < 24 && !premier; m = decalerMois(m, 1), i++) premier = datesFixe(f, m)[0] || '';
    }
    const datePremier = h('input', { type: 'date', value: premier });
    const zonePremier = champ('Date du premier paiement', datePremier,
      'Le premier paiement compte à cette date ; les suivants sont calculés à partir d\'elle (même jour du mois). Si un mois est plus court, le dernier jour du mois est utilisé.');

    // Versements : par mois cochés, ou par dates précises.
    const datesListe = datesChoisies(f);
    let modeDates = f.frequence === 'versements' && datesListe.length > 0;
    const moisChoisis = new Set(moisDuFixe(f));
    const grilleMois = h('div', { class: 'grille-mois' }, ...NOMS_MOIS.map((n, i) => {
      const cb = h('input', { type: 'checkbox', checked: moisChoisis.has(i + 1), onchange: () => cb.checked ? moisChoisis.add(i + 1) : moisChoisis.delete(i + 1) });
      return h('label', {}, cb, n);
    }));
    const zoneMois = champ('Mois de paiement', grilleMois, 'Coche les mois. Le jour vient de la date du premier paiement.');
    const nouvelleDate = h('input', { type: 'date' });
    const pucesDates = h('div', { class: 'puces' });
    function dessinerDates() {
      pucesDates.replaceChildren(...datesListe.map(d => h('span', { class: 'puce' }, d,
        h('button', { type: 'button', 'aria-label': 'Retirer ' + d, onclick: () => { datesListe.splice(datesListe.indexOf(d), 1); dessinerDates(); } }, '✕'))));
      if (!datesListe.length) pucesDates.append(h('small', { class: 'aide' }, 'Aucune date pour l\'instant.'));
    }
    dessinerDates();
    const zoneDates = h('div', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Dates de paiement'),
      h('div', { class: 'rangee-perso' }, nouvelleDate,
        h('button', { type: 'button', class: 'btn secondaire petit', onclick: () => {
          if (!nouvelleDate.value) return toast('Choisis une date dans le calendrier', 'erreur');
          if (!datesListe.includes(nouvelleDate.value)) { datesListe.push(nouvelleDate.value); datesListe.sort(); }
          nouvelleDate.value = ''; dessinerDates();
        } }, '➕ Ajouter')),
      pucesDates);
    const choixMode = (valeur, texte) => h('label', { class: 'case' },
      h('input', { type: 'radio', name: 'mode-versements-' + f.id, checked: modeDates === valeur, onchange: () => { modeDates = valeur; majZones(); } }), texte);
    const zoneMode = h('div', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Choisir par'),
      h('div', { class: 'rangee-perso' }, choixMode(false, 'Mois'), choixMode(true, 'Dates précises (calendrier)')));

    function majZones() {
      const v = freq.value === 'versements';
      zonePerso.style.display = freq.value === 'perso' ? '' : 'none';
      zoneMode.style.display = v ? '' : 'none';
      zoneMois.style.display = v && !modeDates ? '' : 'none';
      zoneDates.style.display = v && modeDates ? '' : 'none';
      zonePremier.style.display = v && modeDates ? 'none' : '';
    }
    majZones();
    const frequenceChoisie = () => freq.value === 'perso'
      ? `perso:${Math.max(1, parseInt(nbPerso.value, 10) || 1)}:${unitePerso.value}` : freq.value;
    const motsCles = h('input', { type: 'text', value: f.motsCles || '', placeholder: 'Ex. : hydro, hydro-quebec' });
    const actif = h('input', { type: 'checkbox', checked: f.actif !== false });
    const histTexte = hist.length > 1 ? h('small', { class: 'aide' }, 'Historique : ',
      hist.map(x => x.du <= '2000-01-01' ? `${argent(x.montant)} au départ` : `${argent(x.montant)} dès le ${x.du}`).join(' · ')) : null;

    corps.append(h('form', { class: 'formulaire', onsubmit: async e => {
      e.preventDefault();
      const m = lireMontant(montant.value);
      if (!nom.value.trim() || !cat.value || m === null) return toast('Nom, catégorie et montant requis', 'erreur');
      const versements = freq.value === 'versements';
      if (freq.value === 'perso' && !(parseInt(nbPerso.value, 10) >= 1)) return toast('Délai personnalisé : un nombre de 1 ou plus', 'erreur');
      if (versements && modeDates && !datesListe.length) return toast('Ajoute au moins une date', 'erreur');
      if (versements && !modeDates && !moisChoisis.size) return toast('Coche au moins un mois', 'erreur');
      if (!(versements && modeDates) && !datePremier.value) return toast('Choisis la date du premier paiement', 'erreur');
      if (!nouveau && !aPartirDu.value) return toast('Choisis à partir de quand le montant s\'applique', 'erreur');
      const frequence = frequenceChoisie();
      // Historique des montants : les paiements avant « à partir du » gardent l'ancien montant.
      let h2 = hist.length ? hist : [{ du: '2000-01-01', montant: nouveau ? m : (Number(f.montant) || 0) }];
      if (!nouveau && m !== montantFixe({ ...f, historique: h2, frequence }, aPartirDu.value)) {
        h2 = h2.filter(x => x.du < aPartirDu.value).concat([{ du: aPartirDu.value, montant: m }]);
        if (!h2.length || h2[0].du > '2000-01-01') h2.unshift({ du: '2000-01-01', montant: hist.length ? hist[0].montant : (Number(f.montant) || 0) });
      }
      const [c, s] = cat.value.split(SEP);
      const rec = { ...f, nom: nom.value.trim(), categorie: c, sousCategorie: s, montant: h2[h2.length - 1].montant, frequence,
        moisPaiement: !versements ? '' : modeDates ? datesListe.join(',') : [...moisChoisis].sort((a, b) => a - b).join(','),
        dateReference: versements && modeDates ? '' : datePremier.value, historique: JSON.stringify(h2),
        motsCles: motsCles.value.split(',').map(normaliser).filter(Boolean).join('|'), actif: actif.checked };
      await sauver('DepensesFixes', rec);
      E.fixes = E.fixes.filter(x => x.id !== rec.id).concat(rec);
      await rafraichirPrevus(rec.id);
      fermer(); rafraichir(); toast('Dépense fixe enregistrée ✓');
    } },
      champ('Nom', nom), champ('Catégorie', cat),
      champ('Fréquence', freq), zonePerso, zoneMode, zonePremier, zoneMois, zoneDates,
      champ('Montant par paiement', montant, 'Modifiable pour un paiement précis dans l\'écran Mouvements.'),
      nouveau ? null : champ('Ce montant s\'applique à partir du', aPartirDu, 'Les paiements avant cette date gardent l\'ancien montant.'),
      histTexte,
      champ('Mots-clés de la facture (facultatif)', motsCles, 'Si une facture contient un de ces mots, l\'app proposera de remplacer cette dépense fixe.'),
      h('label', { class: 'case' }, actif, ' Active'),
      h('div', { class: 'rangee-boutons' },
        nouveau ? null : h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!await confirmer(`Supprimer « ${f.nom} » ? Les mois déjà payés sont conservés.`, { oui: 'Supprimer', danger: true })) return;
          await supprimer('DepensesFixes', f.id);
          E.fixes = E.fixes.filter(x => x.id !== f.id);
          await rafraichirPrevus(f.id);
          fermer(); rafraichir();
        } }, 'Supprimer'),
        h('button', { type: 'submit', class: 'btn primaire' }, 'Enregistrer'))));
  });
}

// ------------------------------------------------------------------ Catégories
function gererCategories(type, rafraichir) {
  feuille(type === 'depense' ? 'Catégories de dépenses' : 'Catégories de revenus', (corps) => {
    function dessiner() {
      corps.replaceChildren();
      for (const [c, sous] of categoriesPar(type)) {
        corps.append(h('div', { class: 'cat-bloc' },
          h('div', { class: 'cat-tete' }, h('strong', {}, `${icone(c)} ${c}`),
            h('button', { class: 'btn-icone', 'aria-label': 'Supprimer la catégorie', onclick: async () => {
              if (!await confirmer(`Supprimer la catégorie « ${c} » et ses sous-catégories ? Les dépenses existantes ne sont pas modifiées.`, { oui: 'Supprimer', danger: true })) return;
              const ids = E.categories.filter(x => x.type === type && x.categorie === c).map(x => x.id);
              await supprimer('Categories', ids);
              E.categories = E.categories.filter(x => !ids.includes(x.id));
              dessiner(); rafraichir();
            } }, '🗑️')),
          h('div', { class: 'puces' }, ...sous.map(s => h('span', { class: 'puce' }, s,
            h('button', { 'aria-label': 'Retirer ' + s, onclick: async () => {
              const rec = E.categories.find(x => x.type === type && x.categorie === c && x.sousCategorie === s);
              if (!rec) return;
              if (sous.length === 1) return toast('Supprime plutôt la catégorie entière', 'info');
              await supprimer('Categories', rec.id);
              E.categories = E.categories.filter(x => x.id !== rec.id);
              dessiner(); rafraichir();
            } }, '✕'))),
            h('button', { class: 'puce ajout', onclick: () => ajouter(c) }, '＋'))));
      }
      corps.append(h('button', { class: 'btn primaire large', onclick: () => ajouter(null) }, '➕ Nouvelle catégorie'));
    }
    async function ajouter(categorie) {
      const nomCat = categorie || prompt('Nom de la nouvelle catégorie :');
      if (!nomCat || !nomCat.trim()) return;
      const sous = prompt(`Sous-catégorie de « ${nomCat.trim()} » :`, categorie ? '' : 'Général');
      if (!sous || !sous.trim()) return;
      const rec = { id: uuid(), type, categorie: nomCat.trim(), sousCategorie: sous.trim(), ordre: E.categories.length + 1 };
      await sauver('Categories', rec);
      E.categories.push(rec);
      dessiner(); rafraichir();
    }
    dessiner();
  });
}

function gererCommerces(rafraichir) {
  feuille('Commerces connus', (corps) => {
    const recherche = h('input', { type: 'search', placeholder: 'Rechercher…', oninput: () => dessiner() });
    const liste = h('div', {});
    corps.append(h('p', { class: 'aide' }, 'L\'app apprend : quand tu classes un nouveau commerce, il s\'ajoute ici. La catégorie proposée est celle que tu choisis le plus souvent.'), recherche, liste);
    function dessiner() {
      const q = normaliser(recherche.value);
      liste.replaceChildren(...E.commerces.filter(c => !q || normaliser(c.nom).includes(q))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
        .map(c => h('div', { class: 'rangee statique' },
          h('span', {}, h('strong', {}, c.nom), h('small', {}, `${c.categorie} › ${c.sousCategorie}`)),
          h('button', { class: 'btn-icone', 'aria-label': 'Supprimer ' + c.nom, onclick: async () => {
            await supprimer('Commerces', c.id);
            E.commerces = E.commerces.filter(x => x.id !== c.id);
            dessiner(); rafraichir();
          } }, '🗑️'))));
    }
    dessiner();
  });
}

export { moisCourant };
