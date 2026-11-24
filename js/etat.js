// Données chargées en mémoire et opérations métier (sauvegarde, apprentissage, matérialisation).
import { tous, sauver, ecrireBrut, getMeta, uuid } from './db.js';
import { categoriesDeDepart, commercesDeDepart, EPOQUE, ICONES } from './defaults.js';
import { moisCourant, occurrencesAMaterialiser, normaliser, trouverCommerce, montantA, datesRevenu, datesFixe, idFixe, montantFixe, aujourdhui, decalerMois } from './calc.js';
import { synchroniserBientot } from './sync.js';

export const E = {
  transactions: [], categories: [], commerces: [], fixes: [], revenus: [], reglages: {},
  moi: '', debut: moisCourant()
};

export async function charger() {
  const [transactions, categories, commerces, fixes, revenus, reglages] = await Promise.all([
    tous('Transactions', true), tous('Categories'), tous('Commerces'), tous('DepensesFixes'),
    tous('Revenus'), tous('Reglages')
  ]);
  E.transactions = transactions;
  E.categories = categories.sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999));
  E.commerces = commerces;
  E.fixes = fixes;
  E.revenus = revenus;
  E.reglages = Object.fromEntries(reglages.map(r => [r.id, r.valeur]));
  E.debut = E.reglages.debut || moisCourant();
  E.moi = (await getMeta('moi')) || '';
  return E;
}

export const donneesCalc = () => ({ transactions: E.transactions, revenus: E.revenus, fixes: E.fixes, debut: E.debut });

export const utilisateurs = () => String(E.reglages.utilisateurs || E.moi || '').split(',').map(s => s.trim()).filter(Boolean);
export const icone = cat => ICONES[cat] || '•';

/** Première utilisation : catégories et commerces de départ. */
export async function initialiserSiVide() {
  const cats = await tous('Categories', true);
  if (!cats.length) {
    await ecrireBrut('Categories', categoriesDeDepart().map(c => ({ ...c, _sale: true })));
    await ecrireBrut('Commerces', commercesDeDepart().map(c => ({ ...c, _sale: true })));
  }
}

export async function reglage(id, valeur) {
  await sauver('Reglages', { id, valeur });
  synchroniserBientot();
}

// ---------- catégories
export function categoriesPar(type) {
  const res = new Map();
  for (const c of E.categories) {
    if (c.type !== type) continue;
    if (!res.has(c.categorie)) res.set(c.categorie, []);
    if (c.sousCategorie && !res.get(c.categorie).includes(c.sousCategorie)) res.get(c.categorie).push(c.sousCategorie);
  }
  return res;
}

/** Catégorie proposée pour un commerce : la plus souvent choisie, sinon celle de la liste. */
export function categoriePour(nomCommerce) {
  const n = normaliser(nomCommerce);
  if (!n) return null;
  const compte = new Map();
  for (const t of E.transactions) {
    if (t.supprime || t.type !== 'depense' || normaliser(t.commerce) !== n) continue;
    const k = t.categorie + '¦' + (t.sousCategorie || '');
    compte.set(k, (compte.get(k) || 0) + 1);
  }
  if (compte.size) {
    const [k] = [...compte.entries()].sort((a, b) => b[1] - a[1])[0];
    const [categorie, sousCategorie] = k.split('¦');
    return { categorie, sousCategorie };
  }
  const c = trouverCommerce(E.commerces, nomCommerce);
  return c ? { categorie: c.categorie, sousCategorie: c.sousCategorie, nom: c.nom } : null;
}

/** Mémorise un commerce inconnu (apprentissage) et compte les utilisations. */
async function apprendreCommerce(nom, categorie, sousCategorie) {
  if (!nom) return;
  const connu = trouverCommerce(E.commerces, nom);
  if (connu) {
    await sauver('Commerces', { ...connu, utilisations: (Number(connu.utilisations) || 0) + 1 });
  } else {
    await sauver('Commerces', {
      id: uuid(), nom: nom.trim(), motsCles: normaliser(nom), categorie, sousCategorie, utilisations: 1
    });
  }
}

// ---------- transactions
/**
 * Enregistre une facture (une ou plusieurs lignes séparées) ou un revenu.
 * lignes = [{ categorie, sousCategorie, montant }]
 */
export async function enregistrerFacture({ factureId, date, commerce, type, lignes, source, note, remplaceFixeId, anciennesLignes = [], historiqueMontant = '' }) {
  const fid = factureId || uuid();
  const mois = date.slice(0, 7);
  const saisiPar = E.moi;
  const recs = lignes.map((l, i) => ({
    id: (remplaceFixeId && i === 0) ? remplaceFixeId : (l.id || uuid()),
    factureId: (remplaceFixeId && lignes.length === 1) ? remplaceFixeId : fid,
    date, mois, type, categorie: l.categorie, sousCategorie: l.sousCategorie || '',
    commerce: commerce || '', montant: l.montant, source: source || 'manuelle',
    refId: l.refId || '', statut: 'confirme', saisiPar: l.saisiPar || saisiPar, note: note || '',
    historiqueMontant: historiqueMontant || ''
  }));
  if (remplaceFixeId) {
    const ancien = E.transactions.find(t => t.id === remplaceFixeId);
    const fx = ancien ? null : E.fixes.find(f => remplaceFixeId.startsWith(`fixe-${f.id}-`));
    if (ancien || fx) { recs[0].refId = ancien ? ancien.refId : fx.id; recs[0].source = 'fixe'; recs[0].historiqueMontant = ''; }
  }
  await sauver('Transactions', recs);
  // Lignes retirées lors d'une modification
  const gardees = new Set(recs.map(r => r.id));
  const retirees = anciennesLignes.filter(l => !gardees.has(l.id)).map(l => ({ ...l, supprime: true }));
  if (retirees.length) await sauver('Transactions', retirees);
  if (type === 'depense' && !remplaceFixeId && commerce) await apprendreCommerce(commerce, lignes[0].categorie, lignes[0].sousCategorie);
  synchroniserBientot();
  return fid;
}

/** Dépense fixe du mois qui correspond à cette facture (pour proposer le remplacement). */
export function fixeCorrespondant(date, commerce, categorie, sousCategorie) {
  const mois = date.slice(0, 7);
  const n = normaliser(commerce);
  const ecart = d => Math.abs(new Date(d) - new Date(date));
  for (const f of E.fixes) {
    if (f.actif === false) continue;
    const memeCat = f.categorie === categorie && (f.sousCategorie || '') === (sousCategorie || '');
    const motCle = n && String(f.motsCles || '').split(/[|,]/).map(normaliser).filter(Boolean).some(k => n.includes(k));
    if (!memeCat && !motCle) continue;
    // Paiements du mois encore prévus (pour un paiement hebdomadaire : le plus proche de la date de la facture).
    const candidats = datesFixe(f, mois).map(d => ({ d, id: idFixe(f, d) }))
      .map(c => ({ ...c, existant: E.transactions.find(t => t.id === c.id) }))
      .filter(c => !(c.existant && (c.existant.supprime || c.existant.statut === 'confirme')))
      .sort((a, b) => ecart(a.d) - ecart(b.d));
    if (candidats.length) {
      const c = candidats[0];
      return { fixe: f, id: c.id, montant: c.existant ? Number(c.existant.montant) : montantFixe(f, c.d) };
    }
  }
  return null;
}

/** Crée dans Transactions les paies et dépenses fixes prévues jusqu'au mois courant. */
export async function materialiser() {
  const occ = occurrencesAMaterialiser(donneesCalc());
  if (!occ.length) return;
  // Date de modification très ancienne : toute vraie modification (confirmation, Sheet) gagne.
  await ecrireBrut('Transactions', occ.map(o => ({ ...o, modifieLe: EPOQUE, supprime: false, _sale: true })));
  synchroniserBientot();
}

/** Paies/revenus prévus dont la date est passée, à confirmer par l'utilisateur courant. */
export function revenusAConfirmer() {
  const auj = aujourdhui();
  return E.transactions.filter(t => !t.supprime && t.type === 'revenu' && t.statut === 'prevu' &&
    t.date <= auj && (!t.saisiPar || t.saisiPar === E.moi))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Après une modification (ou suppression) d'un revenu récurrent ou d'une dépense fixe :
 * met à jour les occurrences encore « prévues » (non confirmées) qui en découlent.
 * Les mois passés ne sont pas réécrits : seul leur montant suit l'historique
 * (« Ce montant s'applique à partir du… »), donc ils gardent l'ancien montant.
 */
export async function rafraichirPrevus(refId) {
  const rev = E.revenus.find(r => r.id === refId);
  const fx = E.fixes.find(f => f.id === refId);
  const courant = moisCourant();
  const maj = [];
  for (const t of E.transactions) {
    if (t.supprime || t.statut !== 'prevu' || t.refId !== refId) continue;
    if (t.mois < courant) {
      const m = rev ? montantA(rev, t.date) : fx ? montantFixe(fx, t.date) : null;
      if (m !== null && m !== Number(t.montant)) maj.push({ ...t, montant: m });
      continue;
    }
    const dateFixe = fx ? datesFixe(fx, t.mois).find(d => idFixe(fx, d) === t.id) : null;
    const valide = rev ? datesRevenu(rev, t.mois).includes(t.date) : !!dateFixe; // modèle supprimé -> occurrence retirée
    if (!valide) { maj.push({ ...t, supprime: true }); continue; }
    const date = dateFixe || t.date; // jour du paiement d'une dépense fixe éventuellement modifié
    const montant = rev ? montantA(rev, date) : montantFixe(fx, date);
    const nom = rev ? rev.nom : fx.nom;
    const categorie = rev ? (rev.categorie || 'Salaire') : fx.categorie;
    const sousCategorie = rev ? (rev.sousCategorie || 'Paie') : fx.sousCategorie;
    if (date !== t.date || montant !== t.montant || nom !== t.commerce || categorie !== t.categorie || sousCategorie !== t.sousCategorie) {
      maj.push({ ...t, date, montant, commerce: nom, categorie, sousCategorie, saisiPar: rev ? (rev.personne || '') : t.saisiPar });
    }
  }
  if (maj.length) await sauver('Transactions', maj);
  synchroniserBientot();
}

export { aujourdhui, decalerMois };
