// Saisie et modification des dépenses / revenus, liste des transactions, confirmation des paies.
import { h, feuille, toast, confirmer, champ, champMontant, lireMontant } from './ui.js';
import { E, categoriesPar, categoriePour, enregistrerFacture, fixeCorrespondant, icone, revenusAConfirmer, donneesCalc } from './etat.js';
import { sauver, supprimer } from './db.js';
import { argent, arrondi, aujourdhui, nomMois, calculerMois, versDate, historiqueMontantDe, montantModifie, normaliser } from './calc.js';
import { synchroniserBientot } from './sync.js';

const SEP = '¦';

function selectCategorie(type, valeur, attrs = {}) {
  const sel = h('select', attrs);
  sel.append(h('option', { value: '' }, '— Choisir —'));
  for (const [cat, sous] of categoriesPar(type)) {
    const groupe = h('optgroup', { label: `${icone(cat)} ${cat}` });
    if (!sous.length) groupe.append(h('option', { value: cat + SEP }, cat));
    for (const s of sous) groupe.append(h('option', { value: cat + SEP + s }, s));
    sel.append(groupe);
  }
  if (valeur) {
    // Valeur absente de la liste (catégorie supprimée) : l'ajouter pour ne rien perdre.
    if (![...sel.options].some(o => o.value === valeur)) {
      const [c, s] = valeur.split(SEP);
      sel.append(h('option', { value: valeur }, `${c} › ${s || ''}`));
    }
    sel.value = valeur;
  }
  return sel;
}
const decouper = v => { const [categorie, sousCategorie = ''] = String(v || '').split(SEP); return { categorie, sousCategorie }; };

/**
 * Formulaire de dépense ou de revenu.
 * options: { type, lignesExistantes, prerempli: { date, commerce, montant }, source }
 */
export function ouvrirSaisie({ type = 'depense', lignesExistantes = null, prerempli = {}, source = 'manuelle' } = {}) {
  const edition = !!(lignesExistantes && lignesExistantes.length);
  const lignesTriees = edition ? [...lignesExistantes].sort((a, b) => b.montant - a.montant) : [];
  const principale = lignesTriees[0];
  const titre = edition ? (type === 'revenu' ? 'Modifier le revenu' : 'Modifier la dépense')
    : (type === 'revenu' ? 'Nouveau revenu' : 'Nouvelle dépense');

  // Marqueur mauve : seulement pour une dépense non fixe déjà enregistrée.
  const suivreMontant = edition && type === 'depense' && principale.source !== 'fixe';
  const totalAvant = edition ? arrondi(lignesTriees.reduce((s, l) => s + Number(l.montant), 0)) : 0;
  const chaineAvant = edition ? historiqueMontantDe(lignesTriees.find(l => historiqueMontantDe(l).length) || {}) : [];

  feuille(titre, (corps, fermer) => {
    let categorieTouchee = edition;
    const date = h('input', { type: 'date', value: principale?.date || prerempli.date || aujourdhui(), required: true });
    const listeId = 'commerces-' + Math.random().toString(36).slice(2);
    const commerce = h('input', {
      type: 'text', list: listeId, autocomplete: 'off', value: principale?.commerce || prerempli.commerce || '',
      placeholder: type === 'revenu' ? 'Ex. : Grand-maman, employeur…' : 'Ex. : IGA, Petro-Canada…'
    });
    const datalist = h('datalist', { id: listeId },
      [...new Set(E.commerces.map(c => c.nom).concat(E.transactions.filter(t => !t.supprime && t.commerce).map(t => t.commerce)))]
        .sort((a, b) => a.localeCompare(b, 'fr')).map(n => h('option', { value: n })));
    const total = champMontant(edition ? arrondi(lignesTriees.reduce((s, l) => s + Number(l.montant), 0)) : prerempli.montant);
    const catPrincipale = selectCategorie(type, principale ? principale.categorie + SEP + (principale.sousCategorie || '') : '',
      { onchange: () => { categorieTouchee = true; majReste(); } });
    const suggestion = h('small', { class: 'aide suggestion' });
    const note = h('input', { type: 'text', value: principale?.note || '', placeholder: 'Facultatif' });

    const zoneSeparee = h('div', { class: 'lignes-separees' });
    const reste = h('div', { class: 'reste' });
    const lignesSep = [];

    function ajouterLigne(l = null) {
      const sel = selectCategorie(type, l ? l.categorie + SEP + (l.sousCategorie || '') : '', { onchange: majReste });
      const m = champMontant(l ? l.montant : '', { oninput: majReste });
      const ligne = { id: l?.id, refId: l?.refId, saisiPar: l?.saisiPar, sel, m, el: null };
      ligne.el = h('div', { class: 'ligne-sep' }, sel, m,
        h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Retirer', onclick: () => {
          lignesSep.splice(lignesSep.indexOf(ligne), 1); ligne.el.remove(); majReste();
        } }, '✕'));
      lignesSep.push(ligne);
      zoneSeparee.append(ligne.el);
      majReste();
      if (!l) sel.focus();
    }

    function majReste() {
      if (!lignesSep.length) { reste.textContent = ''; reste.className = 'reste'; return; }
      const t = lireMontant(total.value) || 0;
      const autres = lignesSep.reduce((s, l) => s + (lireMontant(l.m.value) || 0), 0);
      const r = arrondi(t - autres);
      const nomCat = decouper(catPrincipale.value);
      reste.textContent = `Reste dans ${nomCat.sousCategorie || nomCat.categorie || 'la catégorie principale'} : ${argent(r)}`;
      reste.className = 'reste ' + (r < 0 ? 'negatif' : '');
    }

    function proposer() {
      if (categorieTouchee || type !== 'depense') return;
      const p = categoriePour(commerce.value);
      if (p) {
        catPrincipale.value = p.categorie + SEP + (p.sousCategorie || '');
        if (!catPrincipale.value) catPrincipale.value = p.categorie + SEP;
        suggestion.textContent = `Catégorie proposée selon « ${p.nom || commerce.value} » — modifiable.`;
        majReste();
      }
    }
    commerce.addEventListener('change', proposer);
    commerce.addEventListener('input', () => { if (commerce.value.length >= 3) proposer(); });
    total.addEventListener('input', majReste);

    if (edition) lignesTriees.slice(1).forEach(l => ajouterLigne(l));
    if (!edition && prerempli.commerce) setTimeout(proposer, 0);

    async function enregistrer(ev) {
      ev.preventDefault();
      const t = lireMontant(total.value);
      if (!t || t < 0) return toast('Entre un montant', 'erreur');
      if (!catPrincipale.value) return toast('Choisis une catégorie', 'erreur');
      if (!date.value) return toast('Choisis une date', 'erreur');
      const autres = lignesSep.map(l => ({ id: l.id, refId: l.refId, saisiPar: l.saisiPar, ...decouper(l.sel.value), montant: lireMontant(l.m.value) }));
      if (autres.some(l => !l.categorie || !l.montant)) return toast('Complète chaque ligne séparée', 'erreur');
      const montantPrincipal = arrondi(t - autres.reduce((s, l) => s + l.montant, 0));
      if (montantPrincipal < 0) return toast('Les lignes séparées dépassent le total', 'erreur');
      const lignes = [{ id: principale?.id, refId: principale?.refId, saisiPar: principale?.saisiPar, ...decouper(catPrincipale.value), montant: montantPrincipal }, ...autres]
        .filter((l, i) => i === 0 || l.montant);

      let remplaceFixeId = null;
      if (!edition && type === 'depense' && lignes.length === 1) {
        const fx = fixeCorrespondant(date.value, commerce.value, lignes[0].categorie, lignes[0].sousCategorie);
        if (fx && await confirmer(`Remplacer la dépense fixe « ${fx.fixe.nom} » (${argent(fx.montant)}) de ${nomMois(date.value.slice(0, 7))} par ${argent(t)} ?`,
          { oui: 'Remplacer', non: 'Non, ajouter en plus' })) {
          remplaceFixeId = fx.id;
        }
      }
      // Historique du total : [origine, ..., actuel]. Retour au montant d'origine = plus de marqueur.
      let chaine = suivreMontant ? chaineAvant : [];
      if (suivreMontant && arrondi(t) !== totalAvant) {
        chaine = chaine.length ? [...chaine] : [totalAvant];
        if (arrondi(t) === chaine[0]) chaine = [];
        else chaine.push(arrondi(t));
      }
      await enregistrerFacture({
        factureId: principale?.factureId, date: date.value, commerce: commerce.value.trim(), type, lignes,
        source: principale?.source || source, note: note.value.trim(), remplaceFixeId,
        anciennesLignes: lignesExistantes || [], historiqueMontant: chaine.length >= 2 ? JSON.stringify(chaine) : ''
      });
      fermer();
      toast(edition ? 'Modification enregistrée ✓' : `${type === 'revenu' ? 'Revenu' : 'Dépense'} de ${argent(t)} enregistré${type === 'revenu' ? '' : 'e'} ✓`);
    }

    async function effacer() {
      const msg = principale.source === 'fixe'
        ? `Retirer « ${principale.commerce} » pour ${nomMois(principale.mois)} ? (La dépense fixe reste prévue les autres mois.)`
        : 'Supprimer cette entrée ?';
      if (!await confirmer(msg, { oui: 'Supprimer', danger: true })) return;
      await supprimer('Transactions', lignesExistantes.map(l => l.id));
      synchroniserBientot();
      fermer();
      toast('Supprimé');
    }

    const texteLu = prerempli.texte ? h('details', { class: 'texte-lu' }, h('summary', {}, 'Voir le texte lu sur la photo'),
      h('pre', {}, prerempli.texte)) : null;
    const historiqueTxt = suivreMontant && chaineAvant.length >= 2
      ? h('small', { class: 'montant-modifie' }, `Montant modifié — origine : ${chaineAvant.map(argent).join(' → ')}`) : null;
    const miniature = prerempli.image ? h('button', { type: 'button', class: 'miniature', 'aria-label': 'Voir la facture en grand',
      onclick: () => voirImage(prerempli.image) }, h('img', { src: prerempli.image, alt: 'Facture' }), h('span', {}, '🔍 Toucher pour agrandir')) : null;
    const form = h('form', { class: 'formulaire', onsubmit: enregistrer },
      miniature,
      prerempli.lu ? h('p', { class: 'bandeau-lu' }, '📷 Valeurs lues sur la photo — vérifie-les et corrige au besoin.') : null,
      h('label', { class: 'champ' }, h('span', { class: 'etiquette' }, 'Montant total', historiqueTxt ? ' ' : null, historiqueTxt), total),
      champ(type === 'revenu' ? 'Provenance' : 'Commerce', commerce), datalist,
      champ('Catégorie', catPrincipale), suggestion,
      type === 'depense' ? h('div', {}, zoneSeparee, reste,
        h('button', { type: 'button', class: 'btn lien', onclick: () => ajouterLigne() }, '➕ Séparer dans une autre catégorie')) : null,
      champ('Date', date),
      champ('Note', note),
      h('div', { class: 'rangee-boutons' },
        edition ? h('button', { type: 'button', class: 'btn danger', onclick: effacer }, 'Supprimer') : null,
        h('button', { type: 'submit', class: 'btn primaire' }, 'Enregistrer')),
      edition && principale.saisiPar ? h('small', { class: 'aide centre' }, `Saisi par ${principale.saisiPar}`) : null,
      texteLu);
    corps.append(form);
    if (!edition && !prerempli.montant) setTimeout(() => total.focus(), 250);
  }, { surFermer: () => { if (prerempli.image) URL.revokeObjectURL(prerempli.image); } }); // l'image est jetée
}

/** Affiche la facture en plein écran : toucher pour zoomer, glisser pour se déplacer. */
function voirImage(url) {
  const img = h('img', { src: url, alt: 'Facture' });
  const zone = h('div', { class: 'visionneuse-zone' }, img);
  const fond = h('div', { class: 'visionneuse' }, zone,
    h('button', { type: 'button', class: 'visionneuse-fermer', 'aria-label': 'Fermer', onclick: () => fond.remove() }, '✕'),
    h('p', { class: 'visionneuse-aide' }, 'Touche l\'image pour zoomer'));
  img.addEventListener('click', ev => {
    const zoom = !fond.classList.contains('zoom');
    const r = img.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height;
    fond.classList.toggle('zoom', zoom);
    if (zoom) requestAnimationFrame(() => {
      zone.scrollLeft = px * img.offsetWidth - zone.clientWidth / 2;
      zone.scrollTop = py * img.offsetHeight - zone.clientHeight / 2;
    });
  });
  document.body.append(fond);
}

/** Choix du type d'ajout (bouton ➕). */
export function ouvrirAjout(ouvrirPhoto) {
  feuille('Ajouter', (corps, fermer) => {
    corps.append(h('div', { class: 'grille-choix' },
      h('button', { class: 'choix', onclick: () => { fermer(); ouvrirPhoto(); } }, h('span', { class: 'gros' }, '📷'), 'Photo d\'une facture'),
      h('button', { class: 'choix', onclick: () => { fermer(); ouvrirSaisie({ type: 'depense' }); } }, h('span', { class: 'gros' }, '✍️'), 'Dépense manuelle'),
      h('button', { class: 'choix', onclick: () => { fermer(); ouvrirSaisie({ type: 'revenu' }); } }, h('span', { class: 'gros' }, '💵'), 'Revenu')));
  });
}

/** Liste des transactions d'un mois (regroupées par facture). */
/** Mouvement automatique : dépense fixe ou paie / revenu récurrent (fond pâle dans la liste). */
export const estFixe = t => ['fixe', 'paie', 'revenu-recurrent'].includes(t.source);

/** Mouvements d'un mois. voir = { fixes, saisis } : quels types de mouvements afficher. */
export function ecranTransactions(moisTxt, filtreCategorie = null, voir = { fixes: true, saisis: true }) {
  if (!voir.fixes && !voir.saisis) return h('p', { class: 'vide' }, 'Coche au moins une case ci-dessus.');
  const res = calculerMois(donneesCalc(), moisTxt);
  let lignes = res.lignes.filter(l => estFixe(l) ? voir.fixes : voir.saisis);
  if (filtreCategorie) lignes = lignes.filter(l => l.categorie === filtreCategorie);
  const groupes = grouper(lignes);
  if (!groupes.length) return h('p', { class: 'vide' }, 'Aucun mouvement pour ce mois.');
  return listeEntrees(groupes);
}

function grouper(lignes) {
  const factures = new Map();
  for (const l of lignes) {
    const k = l.factureId || l.id;
    if (!factures.has(k)) factures.set(k, []);
    factures.get(k).push(l);
  }
  return [...factures.values()].sort((a, b) => b[0].date.localeCompare(a[0].date) || (b[0].modifieLe || '').localeCompare(a[0].modifieLe || ''));
}

/**
 * Recherche dans tous les mouvements du fichier.
 * criteres = { type: 'tout' | 'revenu' | 'depense', categorie: '' | nom, texte }
 */
export function rechercherEntrees({ type = 'tout', categorie = '', texte = '' }) {
  let lignes = E.transactions.filter(t => !t.supprime);
  if (type !== 'tout') lignes = lignes.filter(t => t.type === type);
  if (categorie) lignes = lignes.filter(t => t.categorie === categorie);
  let groupes = grouper(lignes);
  const q = normaliser(texte);
  if (q) {
    const chiffres = q.replace(/[\s$]/g, '').replace(',', '.');
    const estMontant = /^\d+(\.\d{0,2})?$/.test(chiffres);
    const correspond = g => {
      const total = arrondi(g.reduce((s, l) => s + Number(l.montant), 0));
      if (estMontant && [total, ...g.map(l => Number(l.montant))].some(m => m.toFixed(2).startsWith(chiffres))) return true;
      return g.some(l => normaliser([l.commerce, l.note, l.categorie, l.sousCategorie, l.saisiPar].join(' ')).includes(q));
    };
    groupes = groupes.filter(correspond);
  }
  return groupes;
}

export function listeEntrees(groupes, { avecAnnee = false } = {}) {
  const liste = h('ul', { class: 'liste-tx' });
  let dateCourante = null;
  const fmtDate = new Intl.DateTimeFormat('fr-CA', avecAnnee
    ? { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }
    : { weekday: 'long', day: 'numeric', month: 'long' });
  for (const g of groupes) {
    if (g[0].date !== dateCourante) {
      dateCourante = g[0].date;
      liste.append(h('li', { class: 'date-sep' }, fmtDate.format(versDate(dateCourante))));
    }
    const total = arrondi(g.reduce((s, l) => s + Number(l.montant), 0));
    const p = [...g].sort((a, b) => b.montant - a.montant)[0];
    const virtuelle = !E.transactions.some(t => t.id === p.id);
    const prevu = p.statut === 'prevu';
    const sousTitre = g.length > 1 ? `${g.length} catégories` : `${p.categorie}${p.sousCategorie ? ' › ' + p.sousCategorie : ''}`;
    liste.append(h('li', {
      class: 'tx' + (prevu ? ' prevu' : '') + (estFixe(p) ? ' fixe' : ''),
      onclick: () => {
        if (virtuelle) return toast('Prévu — modifie le modèle dans Réglages', 'info');
        const tout = E.transactions.filter(t => !t.supprime && (t.factureId || t.id) === (p.factureId || p.id));
        ouvrirSaisie({ type: p.type, lignesExistantes: tout });
      }
    },
      h('span', { class: 'tx-icone' }, icone(p.categorie)),
      h('span', { class: 'tx-texte' },
        h('strong', {}, p.commerce || p.sousCategorie || p.categorie),
        h('small', {}, sousTitre,
          p.source === 'fixe' ? ' · 📌 fixe' : '',
          prevu ? ' · prévu' : '',
          p.saisiPar && E.moi && p.saisiPar !== E.moi ? ` · ${p.saisiPar}` : '')),
      h('span', { class: 'tx-montant ' + (p.type === 'revenu' ? 'positif' : '') + (g.some(montantModifie) ? ' modifie' : ''),
        title: g.some(montantModifie) ? 'Montant modifié après l\'enregistrement' : null },
        (p.type === 'revenu' ? '+ ' : '') + argent(total) + (g.some(montantModifie) ? ' *' : ''))));
  }
  return liste;
}

/** Confirmation des paies / revenus prévus dont la date est passée. */
export function ouvrirConfirmations() {
  const aConfirmer = revenusAConfirmer();
  if (!aConfirmer.length) return;
  const fmtDate = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
  feuille('Revenus à confirmer', (corps, fermer) => {
    corps.append(h('p', { class: 'aide' }, 'Vérifie le montant net reçu, modifie-le au besoin, puis confirme.'));
    for (const t of aConfirmer) {
      const m = champMontant(t.montant);
      const ligne = h('div', { class: 'confirm-ligne' },
        h('div', {}, h('strong', {}, t.commerce), h('small', {}, fmtDate.format(versDate(t.date)))),
        m,
        h('button', { class: 'btn primaire petit', onclick: async () => {
          const v = lireMontant(m.value);
          if (v === null) return toast('Montant invalide', 'erreur');
          await sauver('Transactions', { ...t, montant: v, statut: 'confirme', saisiPar: t.saisiPar || E.moi });
          synchroniserBientot();
          ligne.remove();
          toast(`${t.commerce} : ${argent(v)} confirmé ✓`);
          if (!corps.querySelector('.confirm-ligne')) fermer();
        } }, 'Confirmer'));
      corps.append(ligne);
    }
  });
}
