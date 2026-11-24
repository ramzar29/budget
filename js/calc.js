// Calculs du budget : occurrences des revenus récurrents et des dépenses fixes, totaux par mois.

// ---------- dates (toujours en texte AAAA-MM-JJ, heure locale)
export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const aujourdhui = () => ymd(new Date());
export const moisCourant = () => ym(new Date());
export function versDate(s) { const [a, m, j] = s.split('-').map(Number); return new Date(a, m - 1, j || 1); }
export function finDuMois(moisTxt) { const d = versDate(moisTxt + '-01'); return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
export function decalerMois(moisTxt, n) { const d = versDate(moisTxt + '-01'); d.setMonth(d.getMonth() + n); return ym(d); }

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];
export const nomMois = moisTxt => { const [a, m] = moisTxt.split('-').map(Number); return `${NOMS_MOIS[m - 1]} ${a}`; };
export const nomMoisCourt = moisTxt => NOMS_MOIS[Number(moisTxt.slice(5, 7)) - 1];

const fmt = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
export const argent = n => fmt.format(Math.round((n || 0) * 100) / 100);
export const arrondi = n => Math.round((n || 0) * 100) / 100;

// ---------- revenus récurrents
export function historiqueDe(rev) {
  let h = rev.historique;
  if (typeof h === 'string') { try { h = JSON.parse(h); } catch { h = null; } }
  return Array.isArray(h) ? [...h].sort((a, b) => a.du.localeCompare(b.du)) : [];
}

export function montantA(rev, date) {
  const h = historiqueDe(rev);
  if (!h.length) return Number(rev.montant) || 0;
  let m = h[0].montant;
  for (const e of h) if (e.du <= date) m = e.montant;
  return Number(m) || 0;
}

/** Dates de versement d'un revenu récurrent dans un mois donné. */
export function datesRevenu(rev, moisTxt) {
  if (!rev.dateReference || rev.actif === false) return [];
  const ref = versDate(rev.dateReference);
  const debut = versDate(moisTxt + '-01');
  const fin = finDuMois(moisTxt);
  const dates = [];
  if (rev.frequence === 'hebdo' || rev.frequence === '2sem') {
    const pas = rev.frequence === 'hebdo' ? 7 : 14;
    const d = new Date(ref);
    if (d < debut) {
      const jours = Math.round((debut - d) / 86400000);
      d.setDate(d.getDate() + Math.ceil(jours / pas) * pas);
    }
    while (d <= fin) { if (d >= debut) dates.push(ymd(d)); d.setDate(d.getDate() + pas); }
  } else if (rev.frequence === 'mensuel') {
    if (ym(ref) <= moisTxt) {
      const jour = Math.min(ref.getDate(), fin.getDate());
      dates.push(`${moisTxt}-${pad(jour)}`);
    }
  } else if (rev.frequence === 'annuel') {
    if (ym(ref) <= moisTxt && pad(ref.getMonth() + 1) === moisTxt.slice(5, 7)) {
      dates.push(`${moisTxt}-${pad(Math.min(ref.getDate(), fin.getDate()))}`);
    }
  }
  return dates;
}

// ---------- dépenses fixes
export const FREQUENCES_FIXES = {
  mensuel: 'Chaque mois', '2mois': 'Aux 2 mois', annuel: 'Une fois par année', versements: 'En versements (mois choisis)'
};

export function moisDuFixe(f) {
  if (f.frequence === 'mensuel') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  return String(f.moisPaiement || '').split(/[,; ]+/).map(Number).filter(n => n >= 1 && n <= 12);
}

export function fixeDansLeMois(f, moisTxt) {
  return f.actif !== false && moisDuFixe(f).includes(Number(moisTxt.slice(5, 7)));
}

// ---------- occurrences prévues (virtuelles tant qu'elles ne sont pas dans Transactions)
export function occurrences(donnees, moisTxt) {
  const occ = [];
  if (moisTxt < donnees.debut) return occ;
  for (const rev of donnees.revenus) {
    for (const date of datesRevenu(rev, moisTxt)) {
      occ.push({
        id: `rev-${rev.id}-${date}`, factureId: `rev-${rev.id}-${date}`, date, mois: moisTxt,
        type: 'revenu', categorie: rev.categorie || 'Salaire', sousCategorie: rev.sousCategorie || 'Paie',
        commerce: rev.nom, montant: montantA(rev, date), source: rev.frequence === 'hebdo' || rev.frequence === '2sem' ? 'paie' : 'revenu-recurrent',
        refId: rev.id, statut: 'prevu', saisiPar: rev.personne || '', note: ''
      });
    }
  }
  for (const f of donnees.fixes) {
    if (!fixeDansLeMois(f, moisTxt)) continue;
    occ.push({
      id: `fixe-${f.id}-${moisTxt}`, factureId: `fixe-${f.id}-${moisTxt}`, date: `${moisTxt}-01`, mois: moisTxt,
      type: 'depense', categorie: f.categorie, sousCategorie: f.sousCategorie, commerce: f.nom,
      montant: Number(f.montant) || 0, source: 'fixe', refId: f.id, statut: 'prevu', saisiPar: '', note: ''
    });
  }
  return occ;
}

/**
 * Totaux d'un mois.
 * donnees = { transactions (toutes, y compris supprimées), revenus, fixes, debut }
 */
export function calculerMois(donnees, moisTxt) {
  const tousIds = new Set(donnees.transactions.map(t => t.id));
  const reelles = donnees.transactions.filter(t => !t.supprime && t.mois === moisTxt);
  const virtuelles = occurrences(donnees, moisTxt).filter(o => !tousIds.has(o.id));
  const lignes = reelles.concat(virtuelles);

  let revenus = 0, fixes = 0, variables = 0;
  const parCat = {};
  for (const t of lignes) {
    const m = Number(t.montant) || 0;
    if (t.type === 'revenu') { revenus += m; continue; }
    if (t.source === 'fixe') fixes += m; else variables += m;
    parCat[t.categorie] = (parCat[t.categorie] || 0) + m;
  }
  const depenses = fixes + variables;
  return {
    mois: moisTxt, revenus: arrondi(revenus), fixes: arrondi(fixes), variables: arrondi(variables),
    depenses: arrondi(depenses), restant: arrondi(revenus - depenses),
    parCategorie: Object.entries(parCat).map(([categorie, total]) => ({ categorie, total: arrondi(total) }))
      .sort((a, b) => b.total - a.total),
    lignes
  };
}

/** Cumul depuis janvier (jusqu'au mois courant inclus) et projection jusqu'en décembre. */
export function calculerAnnee(donnees, annee, moisRef = moisCourant()) {
  const mois = [];
  for (let m = 1; m <= 12; m++) {
    const mt = `${annee}-${pad(m)}`;
    const actif = mt >= donnees.debut;
    mois.push({ ...calculerMois(donnees, mt), actif });
  }
  const actifs = mois.filter(m => m.actif);
  const cumul = actifs.filter(m => m.mois <= moisRef).reduce((s, m) => s + m.restant, 0);
  const projection = actifs.reduce((s, m) => s + m.restant, 0);
  return { mois, cumul: arrondi(cumul), projection: arrondi(projection) };
}

/** Occurrences à créer dans Transactions (mois du début du suivi jusqu'au mois courant). */
export function occurrencesAMaterialiser(donnees) {
  const tousIds = new Set(donnees.transactions.map(t => t.id));
  const res = [];
  const fin = moisCourant();
  let m = donnees.debut;
  let garde = 0;
  while (m <= fin && garde++ < 36) {
    for (const o of occurrences(donnees, m)) if (!tousIds.has(o.id)) res.push(o);
    m = decalerMois(m, 1);
  }
  return res;
}

// ---------- texte : normaliser pour la reconnaissance des commerces
export const normaliser = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** Trouve le commerce connu correspondant à un nom ou à un texte (OCR). */
export function trouverCommerce(commerces, texte) {
  const t = normaliser(texte);
  if (!t) return null;
  let meilleur = null, score = 0;
  for (const c of commerces) {
    const cles = [normaliser(c.nom), ...String(c.motsCles || '').split('|').map(normaliser)].filter(Boolean);
    for (const k of cles) {
      const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
      if (re.test(t) && k.length > score) { meilleur = c; score = k.length; }
    }
  }
  return meilleur;
}
